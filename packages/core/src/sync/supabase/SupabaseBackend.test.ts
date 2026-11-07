import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ready } from '../../crypto/sodium';
import { b64ToHex, hexToB64, SupabaseBackend, type SupabaseChannel, type SupabaseLike, type SupabaseQuery } from './SupabaseBackend';
import { ConflictError } from '../SyncBackend';
import type { EncryptedItem, ItemsKeyRecord } from '../../model/types';

beforeAll(ready);

/** put_item RPC와 RLS를 흉내 내는 아주 작은 가짜 Postgres. */
class FakeSupabase implements SupabaseLike {
  tables: Record<string, Map<string, Record<string, unknown>>> = { items: new Map(), items_keys: new Map() };
  listeners: (() => void)[] = [];
  auth = { getUser: async () => ({ data: { user: { id: 'user-1' } } }) };

  from<T = unknown>(table: string): SupabaseQuery<T> {
    const rows = this.tables[table]!;
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let upsertRow: Record<string, unknown> | null = null;
    const run = () => {
      if (upsertRow) {
        rows.set(String(upsertRow.id), { ...upsertRow });
        return { data: [], error: null };
      }
      let out = [...rows.values()].filter((r) => filters.every((f) => f(r)));
      if (orderBy) out = out.sort((a, b) => (String(a[orderBy!.col]) < String(b[orderBy!.col]) ? -1 : 1) * (orderBy!.asc ? 1 : -1));
      return { data: out as T[], error: null };
    };
    const q: SupabaseQuery<T> = {
      select: () => q,
      eq: (c, v) => (filters.push((r) => r[c] === v), q),
      gt: (c, v) => (filters.push((r) => String(r[c]) > String(v)), q),
      order: (c, o) => ((orderBy = { col: c, asc: o?.ascending ?? true }), q),
      upsert: (row) => ((upsertRow = row as Record<string, unknown>), q),
      maybeSingle: async () => {
        const r = run();
        return { data: (r.data?.[0] ?? null) as T | null, error: null };
      },
      then: (onfulfilled, onrejected) => Promise.resolve(run() as { data: T[]; error: null }).then(onfulfilled, onrejected),
    };
    return q;
  }

  async rpc<T = unknown>(fn: string, args?: Record<string, unknown>) {
    if (fn === 'put_item') {
      const p = args!.p as Record<string, unknown> & { id: string; version: number };
      const remote = this.tables.items!.get(p.id);
      if (remote && (remote.version as number) > p.version) return { data: { conflict: remote } as T, error: null };
      this.tables.items!.set(p.id, { ...p });
      for (const l of this.listeners) l();
      return { data: { ok: true } as T, error: null };
    }
    if (fn === 'delete_my_account') {
      this.tables.items!.clear();
      this.tables.items_keys!.clear();
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }

  channel(): SupabaseChannel {
    const listeners = this.listeners;
    const ch: SupabaseChannel = {
      on: (_e, _f, cb) => {
        listeners.push(cb);
        return ch;
      },
      subscribe: () => undefined,
    };
    return ch;
  }
  removeChannel() {
    this.listeners.length = 0;
  }
}

const blob = (id: string, version: number, updatedAt: string): EncryptedItem => ({
  id, type: 'note', itemsKeyId: 'k', nonce: 'AAEC', ciphertext: 'A/7/',
  aad: { v: 1, id, type: 'note' }, version, updatedAt, deletedAt: null, deviceId: 'd',
});
const keyRecord: ItemsKeyRecord = {
  id: 'k', wrappedKey: 'AAEC', wrappedKeyRecovery: 'A/7/',
  kdf: { alg: 'argon2id', salt: 's', opslimit: 3, memlimit: 1 },
  kdfRecovery: { alg: 'argon2id', salt: 's', opslimit: 3, memlimit: 1 },
  protocol: 1, createdAt: '2026-01-01T00:00:00.000Z',
};

describe('SupabaseBackend', () => {
  let db: FakeSupabase;
  let backend: SupabaseBackend;
  beforeEach(() => {
    db = new FakeSupabase();
    backend = new SupabaseBackend(db);
  });

  it('bytea hex ↔ base64 왕복', () => {
    expect(b64ToHex('AAEC')).toBe('\\x000102');
    expect(hexToB64('\\x000102')).toBe('AAEC');
    expect(hexToB64(b64ToHex('A/7/'))).toBe('A/7/');
  });

  it('put/get/list(since): 행에는 user_id가 붙고 암호문은 bytea hex', async () => {
    await backend.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await backend.put(blob('b', 1, '2026-01-02T00:00:00.000Z'));
    const row = db.tables.items!.get('a')!;
    expect(row.user_id).toBe('user-1');
    expect(row.nonce).toBe('\\x000102');
    expect(JSON.stringify(row)).not.toContain('AAEC');
    expect(await backend.get('a')).toEqual(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    expect((await backend.list('2026-01-01T00:00:00.000Z')).map((i) => i.id)).toEqual(['b']);
    expect((await backend.list(null)).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('put: 서버 version이 더 높으면 ConflictError (RPC가 판정)', async () => {
    await backend.put(blob('a', 5, '2026-01-01T00:00:00.000Z'));
    const err = await backend.put(blob('a', 2, '2026-01-03T00:00:00.000Z')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).remote.version).toBe(5);
  });

  it('delete = tombstone put, keys 왕복, subscribe는 변경마다 호출, purgeAll', async () => {
    const calls: number[] = [];
    const off = backend.subscribe(() => calls.push(1));
    await backend.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await backend.delete('a', '2026-01-05T00:00:00.000Z');
    expect((await backend.get('a'))?.deletedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(calls).toHaveLength(2);
    off();

    await backend.putKeys([keyRecord]);
    expect(await backend.getKeys()).toEqual([keyRecord]);
    expect(db.tables.items_keys!.get('k')!.wrapped_key).toBe('\\x000102');

    await backend.purgeAll();
    expect(await backend.list(null)).toEqual([]);
    expect(await backend.getKeys()).toEqual([]);
  });
});
