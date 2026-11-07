import Dexie, { type EntityTable, type Table } from 'dexie';
import type { EncryptedItem, ItemsKeyRecord } from '../model/types';

export type OutboxOp = 'put' | 'delete';
export type OutboxEntry = { id: string; op: OutboxOp; queuedAt: string; seq: number };
/** seq: 자동 증가 기본키. version 번호는 기기마다 따로 올라가므로 (noteId, version)만으로는 유일하지 않다. */
export type VersionEntry = { seq?: number; noteId: string; version: number; item: EncryptedItem; savedAt: string };

/** DATA-MODEL.md §로컬 meta 키. 값 타입은 키마다 다르다. */
export type MetaMap = {
  lastSyncAt: string;
  deviceId: string;
  deviceName: string;
  backend: 'memory' | 'drive' | 'supabase';
  itemsKeyRecord: ItemsKeyRecord;
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
  async pushVersion(item: EncryptedItem): Promise<void> {
    await this.db.transaction('rw', this.db.versions, async () => {
      await this.db.versions.add({ noteId: item.id, version: item.version, item, savedAt: new Date().toISOString() });
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
