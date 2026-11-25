import Dexie, { type EntityTable, type Table } from 'dexie';
import type { EncryptedItem, ItemsKeyRecord } from '../model/types';

export type OutboxOp = 'put' | 'delete';
export type OutboxEntry = { id: string; op: OutboxOp; queuedAt: string; seq: number };
/** seq: 자동 증가 기본키. version 번호는 기기마다 따로 올라가므로 (noteId, version)만으로는 유일하지 않다. */
/** windowStart: 이 스냅샷이 처음 만들어진 시각. 같은 편집 구간의 저장은 이 항목을 덮어쓴다 (pushVersion의 coalesceMs). */
export type VersionEntry = { seq?: number; noteId: string; version: number; item: EncryptedItem; savedAt: string; windowStart?: string };

/** DATA-MODEL.md §로컬 meta 키. 값 타입은 키마다 다르다. */
export type MetaMap = {
  lastSyncAt: string;
  /** 서버 전체를 마지막으로 다시 훑은 시각 (되돌리기 감지, SyncEngine) */
  lastFullCheckAt: string;
  deviceId: string;
  deviceName: string;
  backend: 'memory' | 'drive' | 'supabase';
  itemsKeyRecord: ItemsKeyRecord;
  /** 패스키(지문·Windows Hello)로 여는 데 쓰는, 이 기기 전용 감싼 열쇠. 서버로 가지 않는다. */
  deviceUnlock: DeviceUnlockRecord;
};

export type DeviceUnlockRecord = {
  /** WebAuthn credential id (base64url) */
  credentialId: string;
  /** PRF 평가에 넣는 salt (base64) */
  prfSalt: string;
  /** 인증기가 준 비밀값에서 만든 키로 감싼 itemsKey */
  wrappedKey: string;
  createdAt: string;
};
export type MetaKey = keyof MetaMap;
type MetaRow = { key: MetaKey; value: unknown };

const VERSIONS_KEEP = 20;

/**
 * 기기 로컬 저장소 (IndexedDB via Dexie). 잠금 중에도 남아 있는 것은 전부 암호문 또는 메타.
 * 평문 Note는 절대 여기 들어오지 않는다 — 타입이 EncryptedItem뿐인 것이 그 경계다.
 */
export class LocalStore {
  private readonly db: Dexie & {
    blobs: EntityTable<EncryptedItem, 'id'>;
    outbox: EntityTable<OutboxEntry, 'id'>;
    versions: Table<VersionEntry, number>;
    meta: EntityTable<MetaRow, 'key'>;
  };

  constructor(name = 'vault') {
    this.db = new Dexie(name) as typeof this.db;
    this.db.version(1).stores({
      blobs: 'id, updatedAt',
      outbox: 'id, seq',
      versions: '++seq, noteId',
      meta: 'key',
    });
  }

  // ---- blobs ----
  putBlob(item: EncryptedItem): Promise<unknown> {
    return this.db.blobs.put(item);
  }
  getBlob(id: string): Promise<EncryptedItem | undefined> {
    return this.db.blobs.get(id);
  }
  allBlobs(): Promise<EncryptedItem[]> {
    return this.db.blobs.toArray();
  }

  // ---- outbox ----
  /** 같은 id가 이미 있으면 op만 갱신하고 자리는 유지한다 (먼저 큐에 든 순서 = 업로드 순서). */
  async enqueue(id: string, op: OutboxOp): Promise<void> {
    await this.db.transaction('rw', this.db.outbox, async () => {
      const existing = await this.db.outbox.get(id);
      if (existing) {
        await this.db.outbox.put({ ...existing, op });
        return;
      }
      const last = await this.db.outbox.orderBy('seq').last();
      await this.db.outbox.put({ id, op, queuedAt: new Date().toISOString(), seq: (last?.seq ?? 0) + 1 });
    });
  }
  outbox(): Promise<OutboxEntry[]> {
    return this.db.outbox.orderBy('seq').toArray();
  }
  dequeue(id: string): Promise<void> {
    return this.db.outbox.delete(id);
  }

  // ---- versions (로컬 전용, 최근 20개) ----
  /**
   * coalesceMs를 주면: 같은 기기가 만든 가장 최근 스냅샷이 그 시간 안에 시작됐을 때 새 항목을 만들지 않고 덮어쓴다.
   * 자동 저장(1초 디바운스)이 20칸을 몇 초 만에 다 쓰는 것을 막는다. 구간이 끝나면(기본 5분) 다음 저장이 새 칸을 연다.
   */
  async pushVersion(item: EncryptedItem, opts: { coalesceMs?: number; now?: number } = {}): Promise<void> {
    const now = opts.now ?? Date.now();
    const savedAt = new Date(now).toISOString();
    await this.db.transaction('rw', this.db.versions, async () => {
      if (opts.coalesceMs && opts.coalesceMs > 0) {
        const rows = await this.db.versions.where('noteId').equals(item.id).toArray();
        const latest = rows.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0];
        if (latest && latest.item.deviceId === item.deviceId && now - new Date(latest.windowStart ?? latest.savedAt).getTime() < opts.coalesceMs) {
          await this.db.versions.put({ ...latest, version: item.version, item, savedAt, windowStart: latest.windowStart ?? latest.savedAt });
          return;
        }
      }
      await this.db.versions.add({ noteId: item.id, version: item.version, item, savedAt, windowStart: savedAt });
      const keys = await this.db.versions.where('noteId').equals(item.id).primaryKeys();
      if (keys.length > VERSIONS_KEEP) {
        const sorted = [...keys].sort((a, b) => a - b);
        await this.db.versions.bulkDelete(sorted.slice(0, keys.length - VERSIONS_KEEP));
      }
    });
  }
  /** 최신(마지막에 기록된 것)부터. */
  async versions(noteId: string): Promise<VersionEntry[]> {
    const rows = await this.db.versions.where('noteId').equals(noteId).toArray();
    return rows.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
  }

  // ---- meta ----
  async getMeta<K extends MetaKey>(key: K): Promise<MetaMap[K] | undefined> {
    const row = await this.db.meta.get(key);
    return row?.value as MetaMap[K] | undefined;
  }
  async setMeta<K extends MetaKey>(key: K, value: MetaMap[K]): Promise<void> {
    await this.db.meta.put({ key, value });
  }
  async deleteMeta(key: MetaKey): Promise<void> {
    await this.db.meta.delete(key);
  }

  // ---- lifecycle ----
  /** 모든 스토어 비움. 계정 삭제·강제 재동기화 흐름에서만. */
  async clear(): Promise<void> {
    await this.db.transaction('rw', [this.db.blobs, this.db.outbox, this.db.versions, this.db.meta], async () => {
      await Promise.all([this.db.blobs.clear(), this.db.outbox.clear(), this.db.versions.clear(), this.db.meta.clear()]);
    });
  }
  /** DB 자체를 지운다 (테스트 격리용). */
  async destroy(): Promise<void> {
    await this.db.delete();
  }
}
