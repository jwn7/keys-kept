import { ConflictError, type SyncBackend } from './SyncBackend';
import type { EncryptedItem, ItemsKeyRecord } from '../model/types';

/**
 * 테스트용 인메모리 백엔드. 두 VaultSession이 같은 인스턴스를 공유하면 "두 기기"가 된다.
 * 동작 규칙은 Drive/Supabase 구현체가 따라야 할 기준이기도 하다.
 */
export class MemoryBackend implements SyncBackend {
  readonly kind = 'memory' as const;
  private items = new Map<string, EncryptedItem>();
  private keys: ItemsKeyRecord[] = [];
  private listeners = new Set<() => void>();

  async ping(): Promise<void> {}

  async list(since: string | null): Promise<EncryptedItem[]> {
    return [...this.items.values()]
      .filter((i) => since === null || i.updatedAt > since)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0))
      .map(clone);
  }

  async get(id: string): Promise<EncryptedItem | null> {
    const i = this.items.get(id);
    return i ? clone(i) : null;
  }

  async put(item: EncryptedItem): Promise<void> {
    const remote = this.items.get(item.id);
    if (remote && remote.version > item.version) throw new ConflictError(clone(remote));
    this.items.set(item.id, clone(item));
    this.emit();
  }

  async delete(id: string, deletedAt: string): Promise<void> {
    const remote = this.items.get(id);
    if (!remote) return;
    this.items.set(id, { ...remote, deletedAt, updatedAt: deletedAt, version: remote.version + 1 });
    this.emit();
  }

  async getKeys(): Promise<ItemsKeyRecord[]> {
    return this.keys.map(clone);
  }
  async putKeys(keys: ItemsKeyRecord[]): Promise<void> {
    this.keys = keys.map(clone);
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  async purgeAll(): Promise<void> {
    this.items.clear();
    this.keys = [];
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

function clone<T>(v: T): T {
  return structuredClone(v);
}
