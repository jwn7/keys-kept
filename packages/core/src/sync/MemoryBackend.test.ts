import { describe, expect, it } from 'vitest';
import { MemoryBackend } from './MemoryBackend';
import { ConflictError } from './SyncBackend';
import type { EncryptedItem } from '../model/types';

const blob = (id: string, version: number, updatedAt: string): EncryptedItem => ({
  id,
  type: 'note',
  itemsKeyId: 'k',
  nonce: 'A',
  ciphertext: 'B',
  aad: { v: 1, id, type: 'note' },
  version,
  updatedAt,
  deletedAt: null,
  deviceId: 'd',
});

describe('MemoryBackend', () => {
  it('put/get/list(since) — updatedAt 오름차순, since 초과만', async () => {
    const b = new MemoryBackend();
    await b.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await b.put(blob('b', 1, '2026-01-03T00:00:00.000Z'));
    await b.put(blob('c', 1, '2026-01-02T00:00:00.000Z'));
    expect((await b.list(null)).map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect((await b.list('2026-01-01T00:00:00.000Z')).map((i) => i.id)).toEqual(['c', 'b']);
    expect(await b.get('zzz')).toBeNull();
  });

  it('더 높은 version이 있으면 ConflictError + remote', async () => {
    const b = new MemoryBackend();
    await b.put(blob('a', 3, '2026-01-01T00:00:00.000Z'));
    const err = await b.put(blob('a', 2, '2026-01-02T00:00:00.000Z')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).remote.version).toBe(3);
  });

  it('delete는 tombstone put', async () => {
    const b = new MemoryBackend();
    await b.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await b.delete('a', '2026-01-05T00:00:00.000Z');
    const r = await b.get('a');
    expect(r?.deletedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(r?.updatedAt).toBe('2026-01-05T00:00:00.000Z');
    expect((await b.list(null)).map((i) => i.id)).toEqual(['a']);
  });

  it('keys get/put, purgeAll', async () => {
    const b = new MemoryBackend();
    expect(await b.getKeys()).toEqual([]);
    await b.putKeys([
      {
        id: 'k',
        wrappedKey: 'w',
        wrappedKeyRecovery: 'r',
        kdf: { alg: 'argon2id', salt: 's', opslimit: 1, memlimit: 8192 },
        kdfRecovery: { alg: 'argon2id', salt: 's', opslimit: 1, memlimit: 8192 },
        protocol: 1,
        createdAt: 'now',
      },
    ]);
    expect((await b.getKeys()).map((k) => k.id)).toEqual(['k']);
    await b.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await b.purgeAll();
    expect(await b.getKeys()).toEqual([]);
    expect(await b.list(null)).toEqual([]);
  });
});
