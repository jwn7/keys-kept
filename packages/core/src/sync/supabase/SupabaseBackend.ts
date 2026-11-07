import { ConflictError, OfflineError, type SyncBackend } from '../SyncBackend';
import type { EncryptedItem, ItemsKeyRecord, ItemType, KdfParams } from '../../model/types';
import { fromBase64, toBase64 } from '../../model/codec';

/**
 * supabase-js 중 우리가 쓰는 아주 작은 부분. core는 @supabase/supabase-js를 import하지 않는다 (규칙 8).
 * 실제 클라이언트는 Pro 모듈(앱)에서 만들어 주입한다. 테스트는 가짜로 돈다.
 */
export type PgError = { message: string; code?: string };
export type PgResult<T> = Promise<{ data: T | null; error: PgError | null }>;
export type PgRows<T> = { data: T[] | null; error: PgError | null };
/** supabase-js 쿼리 빌더는 thenable이다: await 하면 {data, error}. */
export interface SupabaseQuery<T> extends PromiseLike<PgRows<T>> {
  select(cols?: string): SupabaseQuery<T>;
  eq(col: string, v: unknown): SupabaseQuery<T>;
  gt(col: string, v: unknown): SupabaseQuery<T>;
  order(col: string, opts?: { ascending?: boolean }): SupabaseQuery<T>;
  upsert(row: unknown): SupabaseQuery<T>;
  maybeSingle(): PgResult<T>;
}
export interface SupabaseChannel {
  on(event: 'postgres_changes', filter: { event: string; schema: string; table: string; filter?: string }, cb: () => void): SupabaseChannel;
  subscribe(): unknown;
}
export interface SupabaseLike {
  from<T = unknown>(table: string): SupabaseQuery<T>;
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): PgResult<T>;
  channel(name: string): SupabaseChannel;
  removeChannel(ch: SupabaseChannel): unknown;
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
}

type ItemRow = {
  id: string;
  type: ItemType;
  items_key_id: string;
  nonce: string; // bytea → "\\x…" hex
  ciphertext: string;
  aad: { v: 1; id: string; type: ItemType };
  version: number;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
};
type KeyRow = {
  id: string;
  wrapped_key: string;
  wrapped_key_recovery: string;
  kdf: KdfParams;
  kdf_recovery: KdfParams;
  protocol: 1;
  created_at: string;
};

/** Supabase 백엔드 (Pro). RLS가 `user_id = auth.uid()`를 지키고, 서버는 암호문만 본다. */
export class SupabaseBackend implements SyncBackend {
  readonly kind = 'supabase' as const;
  private userId: string | null = null;

  constructor(private readonly client: SupabaseLike) {}

  async ping(): Promise<void> {
    await this.uid();
  }

  async list(since: string | null): Promise<EncryptedItem[]> {
    let q = this.client.from<ItemRow>('items').select('*');
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await this.wrap(q.order('updated_at', { ascending: true }));
    if (error) throw this.toError(error);
    return (data ?? []).map(rowToItem).filter((i) => since === null || i.updatedAt > since);
  }

  async get(id: string): Promise<EncryptedItem | null> {
    const { data, error } = await this.wrap(this.client.from<ItemRow>('items').select('*').eq('id', id).maybeSingle());
    if (error) throw this.toError(error);
    return data ? rowToItem(data) : null;
  }

  /** put_item RPC: 서버에서 version 비교 + upsert를 한 트랜잭션으로. 충돌이면 {conflict: row} */
  async put(item: EncryptedItem): Promise<void> {
    const uid = await this.uid();
    const { data, error } = await this.wrap(this.client.rpc<{ ok?: boolean; conflict?: ItemRow }>('put_item', { p: { ...itemToRow(item), user_id: uid } }));
    if (error) throw this.toError(error);
    if (data?.conflict) throw new ConflictError(rowToItem(data.conflict));
  }

  async delete(id: string, deletedAt: string): Promise<void> {
    const remote = await this.get(id);
    if (!remote) return;
    await this.put({ ...remote, deletedAt, updatedAt: deletedAt, version: remote.version + 1 });
  }

  async getKeys(): Promise<ItemsKeyRecord[]> {
    const { data, error } = await this.wrap(this.client.from<KeyRow>('items_keys').select('*').order('created_at', { ascending: true }));
    if (error) throw this.toError(error);
    return (data ?? []).map((r) => ({
      id: r.id,
      wrappedKey: hexToB64(r.wrapped_key),
      wrappedKeyRecovery: hexToB64(r.wrapped_key_recovery),
      kdf: r.kdf,
      kdfRecovery: r.kdf_recovery,
      protocol: 1,
      createdAt: r.created_at,
    }));
  }

  async putKeys(keys: ItemsKeyRecord[]): Promise<void> {
    const uid = await this.uid();
    for (const k of keys) {
      const row = {
        id: k.id,
        user_id: uid,
        wrapped_key: b64ToHex(k.wrappedKey),
        wrapped_key_recovery: b64ToHex(k.wrappedKeyRecovery),
        kdf: k.kdf,
        kdf_recovery: k.kdfRecovery,
        protocol: 1,
        created_at: k.createdAt,
      };
      const { error } = await this.wrap(this.client.from<KeyRow>('items_keys').upsert(row));
      if (error) throw this.toError(error);
    }
  }

  subscribe(onChange: () => void): () => void {
    const ch = this.client.channel('vault-items').on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, onChange);
    ch.subscribe();
    return () => void this.client.removeChannel(ch);
  }

  /** 계정 삭제: security definer 함수가 auth.users 행을 지우고 cascade로 전부 사라진다. */
  async purgeAll(): Promise<void> {
    const { error } = await this.wrap(this.client.rpc('delete_my_account'));
    if (error) throw this.toError(error);
  }

  private async uid(): Promise<string> {
    if (this.userId) return this.userId;
    const { data } = await this.client.auth.getUser();
    if (!data.user) throw new Error('not signed in');
    this.userId = data.user.id;
    return this.userId;
  }

  private async wrap<T>(p: PromiseLike<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      if (e instanceof TypeError) throw new OfflineError(); // fetch 실패
      throw e;
    }
  }

  private toError(e: { message: string; code?: string }): Error {
    if (/fetch|network/i.test(e.message)) return new OfflineError();
    return new Error(`supabase: ${e.message}`);
  }
}

// ---- bytea(hex) ↔ base64 ----
export function b64ToHex(b64: string): string {
  return '\\x' + [...fromBase64(b64)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function hexToB64(hex: string): string {
  const h = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return toBase64(bytes);
}

function rowToItem(r: ItemRow): EncryptedItem {
  return {
    id: r.id,
    type: r.type,
    itemsKeyId: r.items_key_id,
    nonce: hexToB64(r.nonce),
    ciphertext: hexToB64(r.ciphertext),
    aad: r.aad,
    version: r.version,
    updatedAt: new Date(r.updated_at).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    deviceId: r.device_id ?? '',
  };
}

function itemToRow(i: EncryptedItem): Omit<ItemRow, 'device_id'> & { device_id: string } {
  return {
    id: i.id,
    type: i.type,
    items_key_id: i.itemsKeyId,
    nonce: b64ToHex(i.nonce),
    ciphertext: b64ToHex(i.ciphertext),
    aad: i.aad,
    version: i.version,
    updated_at: i.updatedAt,
    deleted_at: i.deletedAt,
    device_id: i.deviceId,
  };
}
