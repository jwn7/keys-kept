import { ConflictError, OfflineError, type SyncBackend } from './SyncBackend';
import type { LocalStore } from '../store/LocalStore';
import type { EncryptedItem, SyncStatus } from '../model/types';

export type SyncEvent = { type: 'status'; status: SyncStatus } | { type: 'changed'; ids: string[] };

export type SyncResult = { pulled: number; pushed: number; conflicts: number; changedIds: string[] };

export type SyncEngineOptions = {
  store: LocalStore;
  backend: SyncBackend;
  deviceId: string;
  /**
   * 충돌에서 진 쪽을 "충돌 사본" 메모로 만들어 돌려준다. 평문이 필요하므로 세션이 구현한다.
   * null이면(잠금 상태 등) 사본 없이 versions에만 보존된다.
   */
  onConflict?: (loser: EncryptedItem, winner: EncryptedItem) => Promise<EncryptedItem | null>;
  isOnline?: () => boolean;
};

/**
 * pull → push → lastSyncAt. 암호문(EncryptedItem)만 다루며 평문을 모른다.
 * 충돌 규칙(SPEC §3.1): updatedAt 큰 쪽 채택, 진 쪽은 충돌 사본 + versions 보존. 조용히 버리지 않는다.
 */
export class SyncEngine {
  private readonly store: LocalStore;
  private readonly backend: SyncBackend;
  private readonly deviceId: string;
  private readonly onConflict: SyncEngineOptions['onConflict'];
  private readonly isOnline: () => boolean;
  private listeners = new Set<(e: SyncEvent) => void>();
  private inflight: Promise<SyncResult> | null = null;
  private _status: SyncStatus = { state: 'offline', pending: 0 };

  constructor(opts: SyncEngineOptions) {
    this.store = opts.store;
    this.backend = opts.backend;
    this.deviceId = opts.deviceId;
    this.onConflict = opts.onConflict;
    this.isOnline = opts.isOnline ?? (() => true);
  }

  get status(): SyncStatus {
    return this._status;
  }

  on(cb: (e: SyncEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** 겹쳐 호출되면 진행 중인 것을 공유한다. */
  sync(): Promise<SyncResult> {
    if (this.inflight) return this.inflight;
    this.inflight = this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, changedIds: [] };
    const changed = new Set<string>();
    if (!this.isOnline()) {
      await this.setOffline();
      return result;
    }
    this.setStatus({ state: 'syncing' });
    try {
      await this.pull(result, changed);
      await this.push(result, changed);
    } catch (e) {
      result.changedIds = [...changed];
      if (changed.size) this.emit({ type: 'changed', ids: result.changedIds });
      if (e instanceof OfflineError) {
        await this.setOffline();
        return result;
      }
      this.setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      return result;
    }
    result.changedIds = [...changed];
    if (changed.size) this.emit({ type: 'changed', ids: result.changedIds });
    const pending = (await this.store.outbox()).length;
    if (pending > 0) this.setStatus({ state: 'offline', pending });
    else if (result.conflicts > 0) this.setStatus({ state: 'conflict', count: result.conflicts });
    else this.setStatus({ state: 'synced', at: new Date().toISOString() });
    return result;
  }

  // ---- pull ----
  private async pull(result: SyncResult, changed: Set<string>): Promise<void> {
    const since = (await this.store.getMeta('lastSyncAt')) ?? null;
    const remoteItems = await this.backend.list(since);
    const pendingIds = new Set((await this.store.outbox()).map((e) => e.id));
    let maxUpdatedAt = since;

    for (const remote of remoteItems) {
      if (maxUpdatedAt === null || remote.updatedAt > maxUpdatedAt) maxUpdatedAt = remote.updatedAt;
      const local = await this.store.getBlob(remote.id);

      if (!local) {
        await this.store.putBlob(remote);
        await this.store.pushVersion(remote);
        changed.add(remote.id);
        result.pulled++;
        continue;
      }
      // 내 업로드의 메아리: 건너뛴다.
      if (remote.deviceId === this.deviceId && remote.version <= local.version) continue;

      if (pendingIds.has(remote.id)) {
        // 양쪽 다 바뀜 → 충돌
        await this.resolve(local, remote, changed);
        result.conflicts++;
        continue;
      }
      if (remote.updatedAt > local.updatedAt || remote.version > local.version) {
        await this.store.putBlob(remote);
        await this.store.pushVersion(remote);
        changed.add(remote.id);
        result.pulled++;
      }
    }
    if (maxUpdatedAt !== null && maxUpdatedAt !== since) await this.store.setMeta('lastSyncAt', maxUpdatedAt);
  }

  // ---- push ----
  private async push(result: SyncResult, changed: Set<string>): Promise<void> {
    for (const entry of await this.store.outbox()) {
      const local = await this.store.getBlob(entry.id);
      if (!local) {
        await this.store.dequeue(entry.id);
        continue;
      }
      try {
        await this.backend.put(local);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        const localWon = await this.resolve(local, e.remote, changed);
        result.conflicts++;
        if (!localWon) continue; // 원격이 이김: outbox는 resolve가 비웠다
        const bumped = await this.store.getBlob(entry.id);
        if (bumped) await this.backend.put(bumped);
      }
      await this.store.dequeue(entry.id);
      result.pushed++;
    }
  }

  /**
   * LWW. 돌려주는 값: 로컬이 이겼는지.
   * 로컬 승: version을 원격보다 높여 push가 통과하게 한다 (version은 암호문 밖 메타라 재암호화 불필요).
   * 원격 승: 원격을 blobs에, 로컬 outbox 항목 제거.
   * 진 쪽: versions에 보존 + (내용이 있으면) onConflict로 충돌 사본.
   * blobs에 들어오는 모든 암호문은 versions에 한 번씩 기록된다. 로컬 저장분은 persist 시점에 이미 기록돼 있다.
   */
  private async resolve(local: EncryptedItem, remote: EncryptedItem, changed: Set<string>): Promise<boolean> {
    const localWins = local.updatedAt >= remote.updatedAt;
    const winner = localWins ? local : remote;
    const loser = localWins ? remote : local;

    await this.store.pushVersion(remote); // 원격본은 이기든 지든 여기서 처음 본다
    if (localWins) {
      const bumped = { ...local, version: Math.max(local.version, remote.version) + 1 };
      await this.store.putBlob(bumped);
    } else {
      await this.store.putBlob(remote);
      await this.store.dequeue(local.id);
      changed.add(remote.id);
    }

    if (loser.deletedAt === null && this.onConflict) {
      const copy = await this.onConflict(loser, winner);
      if (copy) {
        await this.store.putBlob(copy);
        await this.store.pushVersion(copy);
        await this.store.enqueue(copy.id, 'put');
        changed.add(copy.id);
      }
    }
    return localWins;
  }

  // ---- status ----
  private async setOffline(): Promise<void> {
    const pending = (await this.store.outbox()).length;
    this.setStatus({ state: 'offline', pending });
  }
  private setStatus(s: SyncStatus): void {
    this._status = s;
    this.emit({ type: 'status', status: s });
  }
  private emit(e: SyncEvent): void {
    for (const l of this.listeners) l(e);
  }
}
