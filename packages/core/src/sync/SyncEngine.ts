import { ConflictError, OfflineError, type SyncBackend } from './SyncBackend';
import type { LocalStore } from '../store/LocalStore';
import type { EncryptedItem, SyncStatus } from '../model/types';

export type SyncEvent = { type: 'status'; status: SyncStatus } | { type: 'changed'; ids: string[] } | { type: 'rollback'; ids: string[] };

export type SyncResult = {
  pulled: number;
  pushed: number;
  conflicts: number;
  /** 서버가 이 기기보다 옛 버전을 갖고 있어서, 이 기기의 최신본으로 다시 올린 항목 수 */
  rollbacks: number;
  changedIds: string[];
};

/** 평소에는 지난 동기화 이후 바뀐 것만 받는다. 이 간격마다 한 번은 전체를 다시 훑는다. */
const FULL_CHECK_EVERY_MS = 24 * 3600_000;

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
 *
 * 되돌리기 감지(docs/SECURITY.md): 서버를 믿지 않는다. 서버가 내놓은 항목이 이 기기가 이미 가진 것보다
 * 버전도 낮고 시각도 이르면(그리고 내가 올리려고 대기 중인 것이 아니면) 서버가 옛 상태로 돌아간 것이다.
 * 그 항목으로 덮어쓰지 않고, 이 기기의 최신본을 다시 올려 서버를 고치고, 'rollback' 이벤트로 알린다.
 * 이 기기의 blobs가 "내가 본 최신 버전"의 기록이므로 따로 저장하는 것은 없다.
 */
export class SyncEngine {
  private readonly store: LocalStore;
  private readonly backend: SyncBackend;
  private readonly deviceId: string;
  private readonly onConflict: SyncEngineOptions['onConflict'];
  private readonly isOnline: () => boolean;
  private listeners = new Set<(e: SyncEvent) => void>();
  private inflight: Promise<SyncResult> | null = null;
  private inflightFull = false;
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

  /** 겹쳐 호출되면 진행 중인 것을 공유한다. full: 바뀐 것만이 아니라 서버 전체를 다시 훑는다. */
  sync(opts: { full?: boolean } = {}): Promise<SyncResult> {
    if (this.inflight && (this.inflightFull || !opts.full)) return this.inflight;
    const prev = this.inflight;
    this.inflightFull = !!opts.full;
    const p: Promise<SyncResult> = (prev ? prev.then(() => this.run(!!opts.full)) : this.run(!!opts.full)).finally(() => {
      if (this.inflight === p) this.inflight = null;
    });
    this.inflight = p;
    return p;
  }

  private async run(forceFull: boolean): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, rollbacks: 0, changedIds: [] };
    const changed = new Set<string>();
    const rolledBack: string[] = [];
    if (!this.isOnline()) {
      await this.setOffline();
      return result;
    }
    this.setStatus({ state: 'syncing' });
    try {
      const lastFull = await this.store.getMeta('lastFullCheckAt');
      const full = forceFull || !lastFull || Date.now() - Date.parse(lastFull) > FULL_CHECK_EVERY_MS;
      await this.pull(result, changed, rolledBack, full);
      await this.push(result, changed);
      if (full) await this.store.setMeta('lastFullCheckAt', new Date().toISOString());
    } catch (e) {
      result.changedIds = [...changed];
      if (changed.size) this.emit({ type: 'changed', ids: result.changedIds });
      if (e instanceof OfflineError) {
        await this.setOffline();
        return result;
      }
      // 드라이브 모듈을 가져오지 않으려고 이름으로 구분한다 (AuthError: sync/drive/DriveBackend.ts)
      if (e instanceof Error && e.name === 'AuthError') {
        this.setStatus({ state: 'auth', pending: (await this.store.outbox()).length });
        return result;
      }
      this.setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      return result;
    }
    result.changedIds = [...changed];
    if (changed.size) this.emit({ type: 'changed', ids: result.changedIds });
    if (rolledBack.length) this.emit({ type: 'rollback', ids: rolledBack });
    const pending = (await this.store.outbox()).length;
    if (pending > 0) this.setStatus({ state: 'offline', pending });
    else if (result.conflicts > 0) this.setStatus({ state: 'conflict', count: result.conflicts });
    else this.setStatus({ state: 'synced', at: new Date().toISOString() });
    return result;
  }

  // ---- pull ----
  private async pull(result: SyncResult, changed: Set<string>, rolledBack: string[], full: boolean): Promise<void> {
    const since = (await this.store.getMeta('lastSyncAt')) ?? null;
    const remoteItems = await this.backend.list(full ? null : since);
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
      // 되돌리기: 서버 것이 내가 가진 것보다 버전도 낮고 시각도 이르다. 덮어쓰지 않고 내 최신본을 다시 올린다.
      if (!pendingIds.has(remote.id) && remote.version < local.version && remote.updatedAt < local.updatedAt) {
        await this.store.enqueue(local.id, 'put');
        rolledBack.push(local.id);
        result.rollbacks++;
        continue;
      }
      // 내 업로드의 메아리: 건너뛴다.
      if (remote.deviceId === this.deviceId && remote.version <= local.version) continue;

      if (pendingIds.has(remote.id)) {
        // 전체를 다시 훑을 때는 예전에 이미 받아 본 암호문도 다시 온다. 그것은 새 수정이 아니므로 충돌이 아니다.
        if (await this.seenBefore(remote)) continue;
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

  /** 이 암호문을 전에 받은 적이 있는가. 받은 것은 전부 versions에 남으므로 nonce로 알아본다 (nonce는 암호문마다 다르다). */
  private async seenBefore(remote: EncryptedItem): Promise<boolean> {
    return (await this.store.versions(remote.id)).some((v) => v.item.nonce === remote.nonce);
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
