import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from './LocalStore';
import type { EncryptedItem } from '../model/types';

const blob = (id: string, version = 1, updatedAt = '2026-11-07T00:00:00.000Z'): EncryptedItem => ({
  id,
  type: 'note',
  itemsKeyId: 'k',
  nonce: 'AAAA',
  ciphertext: 'BBBB',
  aad: { v: 1, id, type: 'note' },
  version,
  updatedAt,
  deletedAt: null,
  deviceId: 'd',
});

describe('LocalStore', () => {
  let store: LocalStore;
  beforeEach(() => {
    store = new LocalStore(`test-${Math.random()}`);
  });
  afterEach(async () => {
    await store.destroy();
  });

  it('blobs: put/get/all', async () => {
    await store.putBlob(blob('a'));
    await store.putBlob(blob('b'));
    expect(await store.getBlob('a')).toEqual(blob('a'));
    expect(await store.getBlob('zzz')).toBeUndefined();
    expect((await store.allBlobs()).map((b) => b.id).sort()).toEqual(['a', 'b']);
  });

  it('blobs: 같은 id put은 덮어쓴다', async () => {
    await store.putBlob(blob('a', 1));
    await store.putBlob(blob('a', 2));
    expect((await store.getBlob('a'))?.version).toBe(2);
    expect(await store.allBlobs()).toHaveLength(1);
  });

  it('outbox: enqueue 순서 유지, 같은 id 재큐잉은 op를 갱신, dequeue로 제거', async () => {
    await store.enqueue('a', 'put');
    await store.enqueue('b', 'put');
    await store.enqueue('a', 'delete');
    const q = await store.outbox();
    expect(q.map((e) => [e.id, e.op])).toEqual([
      ['a', 'delete'],
      ['b', 'put'],
    ]);
    await store.dequeue('a');
    expect((await store.outbox()).map((e) => e.id)).toEqual(['b']);
  });

  it('versions: 최근 20개만 유지, 최신순 조회', async () => {
    for (let v = 1; v <= 25; v++) await store.pushVersion(blob('a', v));
    const vs = await store.versions('a');
    expect(vs).toHaveLength(20);
    expect(vs[0]?.version).toBe(25);
    expect(vs[19]?.version).toBe(6);
  });

  it('meta: get/set, 없으면 undefined', async () => {
    expect(await store.getMeta('lastSyncAt')).toBeUndefined();
    await store.setMeta('lastSyncAt', '2026-11-07T00:00:00.000Z');
    await store.setMeta('deviceId', 'dev-1');
    expect(await store.getMeta('lastSyncAt')).toBe('2026-11-07T00:00:00.000Z');
    expect(await store.getMeta('deviceId')).toBe('dev-1');
  });

  it('clear: 모든 스토어 비움 (계정 삭제 흐름)', async () => {
    await store.putBlob(blob('a'));
    await store.enqueue('a', 'put');
    await store.setMeta('deviceId', 'x');
    await store.clear();
    expect(await store.allBlobs()).toHaveLength(0);
    expect(await store.outbox()).toHaveLength(0);
    expect(await store.getMeta('deviceId')).toBeUndefined();
  });
});
