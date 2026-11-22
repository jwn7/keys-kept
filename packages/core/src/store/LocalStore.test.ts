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

  it('versions: coalesceMs 안의 저장은 같은 칸을 덮어쓰고, 구간이 지나면 새 칸을 연다', async () => {
    const t0 = Date.UTC(2026, 10, 7);
    const win = 5 * 60_000;
    await store.pushVersion(blob('a', 1), { coalesceMs: win, now: t0 });
    await store.pushVersion(blob('a', 2), { coalesceMs: win, now: t0 + 1_000 });
    await store.pushVersion(blob('a', 3), { coalesceMs: win, now: t0 + 4 * 60_000 });
    expect((await store.versions('a')).map((v) => v.version)).toEqual([3]);
    // 구간은 '처음 만든 시각' 기준: 계속 쓰고 있어도 5분마다 새 칸
    await store.pushVersion(blob('a', 4), { coalesceMs: win, now: t0 + 5 * 60_000 });
    expect((await store.versions('a')).map((v) => v.version)).toEqual([4, 3]);
    // 다른 기기가 만든 스냅샷은 덮어쓰지 않는다
    await store.pushVersion({ ...blob('a', 5), deviceId: 'other' }, { coalesceMs: win, now: t0 + 5 * 60_000 + 1 });
    await store.pushVersion(blob('a', 6), { coalesceMs: win, now: t0 + 5 * 60_000 + 2 });
    expect((await store.versions('a')).map((v) => v.version)).toEqual([6, 5, 4, 3]);
    // coalesceMs 없이 부르면 항상 새 칸 (동기화 엔진·되돌리기)
    await store.pushVersion(blob('a', 7), { now: t0 + 5 * 60_000 + 3 });
    expect(await store.versions('a')).toHaveLength(5);
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
