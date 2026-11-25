import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ready } from '../crypto/sodium';
import { LocalStore } from '../store/LocalStore';
import { MemoryBackend } from './MemoryBackend';
import { VaultSession, isConflictCopy } from '../session/VaultSession';
import { fastKdfParams } from '../test/params';
import { SyncEngine } from './SyncEngine';
import { AuthError } from './drive/DriveBackend';
import type { EncryptedItem, SyncStatus } from '../model/types';

beforeAll(ready);

const tick = (ms = 3) => new Promise((r) => setTimeout(r, ms));

/** 두 "기기": 같은 MemoryBackend, 다른 LocalStore·deviceId. */
describe('SyncEngine — 두 기기 시뮬레이션', () => {
  let backend: MemoryBackend;
  let storeA: LocalStore;
  let storeB: LocalStore;
  let A: VaultSession;
  let B: VaultSession;

  beforeEach(async () => {
    backend = new MemoryBackend();
    storeA = new LocalStore(`A-${Math.random()}`);
    storeB = new LocalStore(`B-${Math.random()}`);
    A = new VaultSession({ store: storeA, backend, deviceId: 'pc-1', deviceName: 'PC', kdfParams: fastKdfParams });
    B = new VaultSession({ store: storeB, backend, deviceId: 'phone-1', deviceName: '폰', kdfParams: fastKdfParams });
    await A.setup('pw');
    await B.unlock('pw');
  });
  afterEach(async () => {
    await storeA.destroy();
    await storeB.destroy();
  });

  describe('되돌리기 감지 (서버가 옛 암호문을 다시 내놓을 때)', () => {
    it('덮어쓰지 않고, 이 기기의 최신본으로 서버를 되돌려 놓고, 알린다', async () => {
      const n = await A.save({ title: '계약 조건', body: '초안' });
      await A.sync();
      const old = (await backend.get(n.id))!;
      await tick();
      await A.save({ id: n.id, body: '최종본' });
      await A.sync();
      const events: number[] = [];
      A.subscribe((e) => e.type === 'rollback' && events.push(e.count));

      backend.forceSet(old); // 서버가 옛 버전으로 돌아갔다
      const r = await A.sync({ full: true });

      expect(r.rollbacks).toBe(1);
      expect(events).toEqual([1]);
      expect(A.get(n.id)?.body).toBe('최종본'); // 로컬은 그대로
      expect((await backend.get(n.id))!.version).toBeGreaterThan(old.version); // 서버도 최신본으로
      expect(await storeA.outbox()).toHaveLength(0);
      expect(A.status.state).toBe('synced');
      // 다른 기기는 옛 버전이 아니라 최종본을 받는다
      await B.sync();
      expect(B.get(n.id)?.body).toBe('최종본');
    });

    it('지운 메모를 서버가 되살려 놓아도 다시 살아나지 않는다', async () => {
      const n = await A.save({ title: '지울 메모', body: '비밀' });
      await A.sync();
      const alive = (await backend.get(n.id))!;
      await tick();
      await A.delete(n.id);
      await A.sync();

      backend.forceSet(alive);
      const r = await A.sync({ full: true });

      expect(r.rollbacks).toBe(1);
      expect(A.get(n.id)).toBeUndefined();
      expect((await backend.get(n.id))!.deletedAt).not.toBeNull();
    });

    it('정상 흐름은 되돌리기로 보지 않는다: 다른 기기의 새 수정, 내가 아직 안 올린 수정', async () => {
      const n = await A.save({ title: '공유', body: 'v1' });
      await A.sync();
      await B.sync();
      await tick();
      await B.save({ id: n.id, body: 'v2 (폰)' });
      await B.sync();
      expect((await A.sync({ full: true })).rollbacks).toBe(0);
      expect(A.get(n.id)?.body).toBe('v2 (폰)');
      await tick();
      await A.save({ id: n.id, body: 'v3 (아직 안 올림)' }); // 서버는 v2, 로컬은 v3 대기 중
      const r = await A.sync({ full: true });
      expect(r.rollbacks).toBe(0);
      expect(r.pushed).toBe(1);
    });

    it('하루에 한 번은 전체를 다시 훑는다 (바뀐 것만 받는 평소 동기화는 옛 날짜의 암호문을 못 본다)', async () => {
      await A.save({ title: 'x', body: 'y' });
      await A.sync(); // 올림
      await A.sync(); // 서버에 생긴 것을 확인하며 lastSyncAt이 정해진다
      await A.sync();
      expect(backend.listCalls.at(-1)).not.toBeNull(); // 방금 전체를 봤으면 평소대로
      await storeA.setMeta('lastFullCheckAt', new Date(Date.now() - 25 * 3600_000).toISOString());
      await A.sync();
      expect(backend.listCalls.at(-1)).toBeNull(); // 하루가 지났으면 전체
    });
  });

  it('1. A 저장 → A sync → B sync → B에 같은 메모', async () => {
    const n = await A.save({ title: 'PC에서 씀', body: '본문' });
    const ra = await A.sync();
    expect(ra.pushed).toBe(1);
    expect(await storeA.outbox()).toHaveLength(0);

    const rb = await B.sync();
    expect(rb.pulled).toBe(1);
    expect(B.get(n.id)).toEqual(n);
    expect(B.status.state).toBe('synced');
  });

  it('2. 동시 수정 충돌 → updatedAt 큰 쪽 채택, 진 쪽은 충돌 사본으로 양쪽에 보존', async () => {
    const n = await A.save({ title: '공유 메모', body: 'v0' });
    await A.sync();
    await B.sync();

    await B.save({ id: n.id, title: '공유 메모', body: '폰에서 수정' });
    await tick();
    await A.save({ id: n.id, title: '공유 메모', body: 'PC에서 수정 (나중)' });

    const rb = await B.sync(); // B 먼저 올림
    expect(rb.conflicts).toBe(0);
    const ra = await A.sync(); // A는 push에서 ConflictError → LWW: A(나중)가 이김
    expect(ra.conflicts).toBe(1);

    const aNotes = A.list();
    expect(aNotes).toHaveLength(2);
    expect(A.get(n.id)?.body).toBe('PC에서 수정 (나중)');
    const copyA = aNotes.find((x) => x.id !== n.id);
    expect(copyA && isConflictCopy(copyA)).toBe(true);
    expect(copyA?.body).toBe('폰에서 수정');
    expect(copyA?.title).toContain('충돌 사본');

    await B.sync();
    expect(B.get(n.id)?.body).toBe('PC에서 수정 (나중)');
    expect(B.list()).toHaveLength(2);
    expect(B.list().find((x) => x.id !== n.id)?.body).toBe('폰에서 수정');
    expect(B.status.state).toBe('synced');
  });

  it('3. 오프라인: 변경은 outbox에 쌓이고 status=offline, 복귀 후 flush', async () => {
    backend.offline = true;
    await A.save({ title: '오프라인 메모', body: '' });
    await A.save({ title: '하나 더', body: '' });
    const r = await A.sync();
    expect(r.pushed).toBe(0);
    expect(A.status).toEqual<SyncStatus>({ state: 'offline', pending: 2 });
    expect(await storeA.outbox()).toHaveLength(2);

    backend.offline = false;
    const r2 = await A.sync();
    expect(r2.pushed).toBe(2);
    expect(await storeA.outbox()).toHaveLength(0);
    await B.sync();
    expect(B.list()).toHaveLength(2);
  });

  it('4. tombstone 전파: A 삭제 → B에서 목록에서 사라지고 blob은 deletedAt', async () => {
    const n = await A.save({ title: '지울 메모', body: '' });
    await A.sync();
    await B.sync();
    expect(B.list()).toHaveLength(1);

    await A.delete(n.id);
    await A.sync();
    await B.sync();
    expect(B.list()).toHaveLength(0);
    expect((await storeB.getBlob(n.id))?.deletedAt).not.toBeNull();
  });

  it('5. 증분: 두 번째 sync는 lastSyncAt 이후만 요청하고 중복 pull 없음', async () => {
    await A.save({ title: '1', body: '' });
    await A.sync();
    await B.sync();
    expect(backend.listCalls.at(-1)).toBeNull(); // B 첫 sync는 전체
    await tick();
    await A.save({ title: '2', body: '' });
    await A.sync();
    const before = await storeB.getMeta('lastSyncAt');
    expect(typeof before).toBe('string');
    const r = await B.sync();
    expect(backend.listCalls.at(-1)).toBe(before);
    expect(await storeB.getMeta('lastSyncAt')).not.toBe(before);
    expect(r.pulled).toBe(1);
    expect(B.list()).toHaveLength(2);
  });

  it('6. 자기 업로드 메아리: 연속 sync가 변경·충돌을 만들지 않는다', async () => {
    await A.save({ title: '메아리', body: '' });
    await A.sync();
    const r = await A.sync();
    expect(r.pulled).toBe(0);
    expect(r.conflicts).toBe(0);
    expect(A.list()).toHaveLength(1);
    expect((await storeA.versions(A.list()[0]!.id))).toHaveLength(1);
  });

  it('7. 로컬 편집 vs 원격 삭제: 편집이 나중이면 편집이 이기고 사본은 만들지 않는다', async () => {
    const n = await A.save({ title: 'x', body: 'v0' });
    await A.sync();
    await B.sync();
    await B.delete(n.id);
    await tick();
    await A.save({ id: n.id, title: 'x', body: '살림' });
    await B.sync();
    const ra = await A.sync();
    expect(ra.conflicts).toBe(1);
    expect(A.list()).toHaveLength(1); // tombstone은 사본을 만들 내용이 없다
    expect(A.get(n.id)?.body).toBe('살림');
    await B.sync();
    expect(B.get(n.id)?.body).toBe('살림');
  });

  it('8. 잠긴 상태에서도 sync는 돌고(암호문만), 진 쪽은 versions에 보존', async () => {
    const n = await A.save({ title: 'x', body: 'v0' });
    await A.sync();
    await B.sync();
    await B.save({ id: n.id, body: '폰 수정' });
    await tick();
    await A.save({ id: n.id, body: 'PC 수정' });
    await A.sync();
    B.lock();
    const rb = await B.sync();
    expect(rb.conflicts).toBe(1);
    const vs = await storeB.versions(n.id);
    expect(vs.length).toBeGreaterThanOrEqual(2);
    await B.unlock('pw');
    expect(B.get(n.id)?.body).toBe('PC 수정');
    expect(B.list()).toHaveLength(1); // 잠긴 상태라 사본은 못 만들었지만 versions에 남아 있다
    const bodies = (await B.history(n.id)).map((h) => h.note.body);
    expect(bodies).toContain('폰 수정');
    expect(bodies).toContain('PC 수정');
  });

  it('이벤트: status와 changed가 발행된다', async () => {
    const events: string[] = [];
    const off = B.subscribe((e) => events.push(e.type));
    await A.save({ title: 'ev', body: '' });
    await A.sync();
    await B.sync();
    off();
    expect(events).toContain('status');
    expect(events).toContain('notes');
  });
});

describe('SyncEngine — 단위', () => {
  const blob = (id: string, version: number, updatedAt: string, deviceId = 'other'): EncryptedItem => ({
    id, type: 'note', itemsKeyId: 'k', nonce: 'A', ciphertext: 'B',
    aad: { v: 1, id, type: 'note' }, version, updatedAt, deletedAt: null, deviceId,
  });
  let store: LocalStore;
  beforeEach(() => { store = new LocalStore(`eng-${Math.random()}`); });
  afterEach(async () => { await store.destroy(); });

  it('push ConflictError → LWW 후 재시도, onConflict 훅 호출', async () => {
    const backend = new MemoryBackend();
    await backend.put(blob('a', 5, '2026-01-02T00:00:00.000Z'));
    await store.putBlob(blob('a', 1, '2026-01-03T00:00:00.000Z', 'me'));
    await store.enqueue('a', 'put');
    const seen: [string, string][] = [];
    const engine = new SyncEngine({
      store, backend, deviceId: 'me',
      onConflict: async (loser, winner) => { seen.push([loser.deviceId, winner.deviceId]); return null; },
    });
    const r = await engine.sync();
    expect(r.conflicts).toBe(1);
    expect(seen).toEqual([['other', 'me']]);
    const remote = await backend.get('a');
    expect(remote?.version).toBe(6);
    expect(remote?.updatedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(await store.outbox()).toHaveLength(0);
  });

  it('동시 sync 호출은 직렬화된다', async () => {
    const backend = new MemoryBackend();
    const engine = new SyncEngine({ store, backend, deviceId: 'me' });
    const [a, b] = await Promise.all([engine.sync(), engine.sync()]);
    expect(a).toEqual(b);
  });

  it('백엔드 예외 → status error, 메시지 포함', async () => {
    const backend = new MemoryBackend();
    backend.list = async () => { throw new Error('boom'); };
    const engine = new SyncEngine({ store, backend, deviceId: 'me' });
    await engine.sync();
    expect(engine.status).toEqual({ state: 'error', message: 'boom' });
  });

  it('인증 만료(AuthError) → status auth, 대기 중인 변경은 outbox에 남는다', async () => {
    const backend = new MemoryBackend();
    backend.list = async () => { throw new AuthError('drive 401'); };
    await store.putBlob(blob('a', 1, '2026-01-03T00:00:00.000Z', 'me'));
    await store.enqueue('a', 'put');
    const engine = new SyncEngine({ store, backend, deviceId: 'me' });
    await engine.sync();
    expect(engine.status).toEqual({ state: 'auth', pending: 1 });
    expect(await store.outbox()).toHaveLength(1);
  });
});
