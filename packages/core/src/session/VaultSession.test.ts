import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ready } from '../crypto/sodium';
import { LocalStore } from '../store/LocalStore';
import { MemoryBackend } from '../sync/MemoryBackend';
import { LockedError, VaultMismatchError, VaultSession, WrongPasswordError } from './VaultSession';
import { fastKdfParams } from '../test/params';

beforeAll(ready);

const tick = () => new Promise((r) => setTimeout(r, 2));

describe('VaultSession', () => {
  let store: LocalStore;
  let backend: MemoryBackend;
  const make = (s = store, b = backend, deviceId = 'pc-1') =>
    new VaultSession({ store: s, backend: b, deviceId, kdfParams: fastKdfParams });

  beforeEach(() => {
    store = new LocalStore(`session-${Math.random()}`);
    backend = new MemoryBackend();
  });
  afterEach(async () => {
    await store.destroy();
  });

  it('setup → 복구키 12단어, 백엔드에 ItemsKeyRecord 1개, 로컬 meta에도 복사', async () => {
    const s = make();
    const { recoveryPhrase } = await s.setup('correct horse battery staple');
    expect(recoveryPhrase).toHaveLength(12);
    const keys = await backend.getKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ protocol: 1, kdf: { alg: 'argon2id' }, kdfRecovery: { alg: 'argon2id' } });
    expect(keys[0]?.wrappedKey).not.toBe(keys[0]?.wrappedKeyRecovery);
    expect(s.isLocked).toBe(false);
    expect(await store.getMeta('itemsKeyRecord')).toEqual(keys[0]);
  });

  it('versionWindowMs: 자동 저장은 한 칸으로 묶이고, 되돌리기는 직전 상태를 지우지 않는다', async () => {
    const s = new VaultSession({ store, backend, deviceId: 'pc-1', kdfParams: fastKdfParams, versionWindowMs: 60_000 });
    await s.setup('pw');
    const n = await s.save({ title: 't', body: '1' });
    await s.save({ id: n.id, body: '12' });
    await s.save({ id: n.id, body: '123' });
    expect((await s.history(n.id)).map((h) => h.note.body)).toEqual(['123']);
    await s.revert(n.id, (await s.history(n.id))[0]!.version);
    await s.save({ id: n.id, body: '새 글' }, { snapshot: true });
    expect((await s.history(n.id)).map((h) => h.note.body)).toEqual(['새 글', '123', '123']);
  });

  it('save → list, 암호문만 blobs에, outbox에 put 1개', async () => {
    const s = make();
    await s.setup('pw');
    const note = await s.save({ title: '첫 메모', body: '안녕 #인사' });
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.tags).toEqual(['인사']);
    expect(s.list().map((n) => n.id)).toEqual([note.id]);

    const blobs = await store.allBlobs();
    expect(blobs).toHaveLength(1);
    expect(JSON.stringify(blobs)).not.toContain('첫 메모');
    expect(blobs[0]?.version).toBe(1);
    expect((await store.outbox()).map((e) => e.op)).toEqual(['put']);
  });

  it('두 번 save → version 2, updatedAt 증가, versions 기록 2개', async () => {
    const s = make();
    await s.setup('pw');
    const a = await s.save({ title: 'v1', body: '' });
    await tick();
    const b = await s.save({ id: a.id, title: 'v2', body: '' });
    expect(b.updatedAt > a.updatedAt).toBe(true);
    expect(b.createdAt).toBe(a.createdAt);
    expect((await store.getBlob(a.id))?.version).toBe(2);
    expect((await store.versions(a.id)).map((v) => v.version)).toEqual([2, 1]);
    expect(s.get(a.id)?.title).toBe('v2');
  });

  it('lock → list/get/save 불가, unlock(비밀번호) → 같은 메모 복원', async () => {
    const s = make();
    await s.setup('pw');
    const n = await s.save({ title: '잠금 테스트', body: 'body' });
    s.lock();
    expect(s.isLocked).toBe(true);
    expect(() => s.list()).toThrow(LockedError);
    await expect(s.save({ title: 'x', body: '' })).rejects.toThrow(LockedError);

    await s.unlock('pw');
    expect(s.list()).toHaveLength(1);
    expect(s.get(n.id)).toEqual(n);
  });

  it('틀린 비밀번호 → WrongPasswordError, 잠금 유지', async () => {
    const s = make();
    await s.setup('pw');
    s.lock();
    await expect(s.unlock('nope')).rejects.toThrow(WrongPasswordError);
    expect(s.isLocked).toBe(true);
  });

  it('새 기기: 빈 로컬 + 같은 백엔드 → 백엔드 keys로 unlock', async () => {
    const s1 = make();
    await s1.setup('pw');
    await s1.save({ title: '기기1', body: '' });

    const store2 = new LocalStore(`session2-${Math.random()}`);
    const s2 = make(store2, backend, 'phone-1');
    await s2.unlock('pw'); // meta 없음 → backend.getKeys()
    expect(s2.isLocked).toBe(false);
    expect(s2.list()).toHaveLength(0); // 블롭 동기화는 2단계
    expect(await store2.getMeta('itemsKeyRecord')).toBeDefined();
    await store2.destroy();
  });

  it('로컬 전용으로 시작한 볼트를 나중에 빈 백엔드에 연결하면 sync가 열쇠를 올리고, 새 기기가 그 열쇠로 연다', async () => {
    const local = new MemoryBackend(); // Drive 연결 전 (앱의 로컬 전용 모드)
    const s1 = make(store, local);
    await s1.setup('pw');
    await s1.save({ title: '처음 메모', body: '본문' });
    expect(await backend.getKeys()).toHaveLength(0);

    // 같은 기기, 이제 Drive(backend)에 연결된 상태로 다시 열기
    const s1d = make(store, backend);
    await s1d.unlock('pw');
    await s1d.sync();
    expect((await backend.getKeys()).map((k) => k.id)).toEqual([(await store.getMeta('itemsKeyRecord'))!.id]);

    // 새 기기: 빈 로컬 + 같은 Drive
    const store2 = new LocalStore(`session2-${Math.random()}`);
    const s2 = make(store2, backend, 'phone-1');
    await s2.unlock('pw');
    await s2.sync();
    expect(s2.list().map((n) => n.title)).toEqual(['처음 메모']);
    await store2.destroy();
  });

  it('Drive에 다른 볼트의 열쇠가 있으면 sync는 VaultMismatchError로 멈추고 아무것도 올리지 않는다', async () => {
    const other = make(new LocalStore(`other-${Math.random()}`), backend, 'other');
    await other.setup('다른 비밀번호');
    const before = await backend.getKeys();

    const mine = make(store, new MemoryBackend());
    await mine.setup('pw');
    await mine.save({ title: '내 메모', body: '' });
    const mineOnDrive = make(store, backend);
    await mineOnDrive.unlock('pw');
    await expect(mineOnDrive.sync()).rejects.toBeInstanceOf(VaultMismatchError);
    expect(mineOnDrive.status).toMatchObject({ state: 'error' });
    expect(await backend.getKeys()).toEqual(before);
    expect(await backend.list(null)).toHaveLength(0);
  });

  it('date(일정 날짜): 암호문 안에 저장되고, 생략하면 이전 값 유지, null이면 지운다', async () => {
    const s = make();
    await s.setup('pw');
    const n = await s.save({ title: '치과', body: '', date: '2026-11-24' });
    expect(n.date).toBe('2026-11-24');
    expect(JSON.stringify(await store.allBlobs())).not.toContain('2026-11-24');
    await s.save({ id: n.id, body: '오후 3시' });
    s.lock();
    await s.unlock('pw');
    expect(s.get(n.id)?.date).toBe('2026-11-24');
    await s.save({ id: n.id, date: null });
    expect(s.get(n.id)?.date ?? null).toBeNull();
    // date 없이 만든 메모(이전 버전 앱)는 null로 읽힌다
    const plain = await s.save({ title: '날짜 없음', body: '' });
    expect(plain.date ?? null).toBeNull();
  });

  it('기기 잠금 해제(패스키): 비밀값으로 감싼 열쇠를 이 기기에만 두고, 그 값으로 다시 연다', async () => {
    const s = make();
    await s.setup('pw');
    await s.save({ title: '메모', body: '본문' });
    expect(await s.deviceUnlockInfo()).toBeNull();
    const secret = crypto.getRandomValues(new Uint8Array(32));
    await s.enableDeviceUnlock(secret, { credentialId: 'cred-1', prfSalt: 'c2FsdA==' });
    expect(await s.deviceUnlockInfo()).toEqual({ credentialId: 'cred-1', prfSalt: 'c2FsdA==' });
    // 서버에는 아무것도 추가되지 않는다 (감싼 열쇠는 이 기기 전용)
    expect(JSON.stringify(await backend.getKeys())).not.toContain('cred-1');

    s.lock();
    await expect(s.unlockWithDeviceSecret(crypto.getRandomValues(new Uint8Array(32)))).rejects.toBeInstanceOf(WrongPasswordError);
    expect(s.isLocked).toBe(true);
    await s.unlockWithDeviceSecret(secret);
    expect(s.list().map((n) => n.title)).toEqual(['메모']);

    // 비밀번호를 바꿔도 기기 잠금 해제는 그대로 (itemsKey는 같다)
    await s.changePassword('pw', '새 비밀번호');
    s.lock();
    await s.unlockWithDeviceSecret(secret);
    expect(s.isLocked).toBe(false);

    await s.disableDeviceUnlock();
    expect(await s.deviceUnlockInfo()).toBeNull();
    s.lock();
    await expect(s.unlockWithDeviceSecret(secret)).rejects.toThrow();
  });

  it('sealLocal/openLocal: 이 기기에만 두는 설정값을 itemsKey로 잠근다 (잠겨 있으면 못 연다)', async () => {
    const s = make();
    await s.setup('pw');
    const sealed = s.sealLocal('백업 비밀번호 1234');
    expect(sealed).not.toContain('1234');
    expect(s.openLocal(sealed)).toBe('백업 비밀번호 1234');
    expect(s.openLocal('엉터리')).toBeNull();
    expect(s.sealLocal('같은 값')).not.toBe(s.sealLocal('같은 값'));
    s.lock();
    expect(() => s.openLocal(sealed)).toThrow(LockedError);
  });

  it('delete → tombstone: list에서 빠지고 blob은 deletedAt 설정, outbox delete', async () => {
    const s = make();
    await s.setup('pw');
    const n = await s.save({ title: '지울 것', body: '' });
    await s.delete(n.id);
    expect(s.list()).toHaveLength(0);
    const b = await store.getBlob(n.id);
    expect(b?.deletedAt).not.toBeNull();
    expect(b?.version).toBe(2);
    expect((await store.outbox()).map((e) => e.op)).toEqual(['delete']);
  });

  it('list 정렬: 핀 먼저, 그다음 updatedAt 내림차순', async () => {
    const s = make();
    await s.setup('pw');
    const a = await s.save({ title: 'a', body: '' });
    await tick();
    const b = await s.save({ title: 'b', body: '' });
    await tick();
    await s.save({ id: a.id, title: 'a', body: '', pinned: true });
    expect(s.list().map((n) => n.title)).toEqual(['a', 'b']);
    expect(b.pinned).toBe(false);
  });

  it('changePassword: wrappedKey만 바뀌고 blobs는 그대로, 새 비밀번호로 unlock', async () => {
    const s = make();
    await s.setup('old');
    const n = await s.save({ title: '유지', body: '' });
    const before = (await store.allBlobs())[0];
    const keyBefore = (await backend.getKeys())[0];

    await s.changePassword('old', 'new');
    const keyAfter = (await backend.getKeys())[0];
    expect(keyAfter?.id).toBe(keyBefore?.id);
    expect(keyAfter?.wrappedKey).not.toBe(keyBefore?.wrappedKey);
    expect(keyAfter?.wrappedKeyRecovery).toBe(keyBefore?.wrappedKeyRecovery);
    expect((await store.allBlobs())[0]).toEqual(before);

    s.lock();
    await expect(s.unlock('old')).rejects.toThrow(WrongPasswordError);
    await s.unlock('new');
    expect(s.get(n.id)?.title).toBe('유지');
  });

  it('changePassword: 현재 비밀번호가 틀리면 WrongPasswordError, 키 레코드 불변', async () => {
    const s = make();
    await s.setup('old');
    const keyBefore = (await backend.getKeys())[0];
    await expect(s.changePassword('wrong', 'new')).rejects.toThrow(WrongPasswordError);
    expect((await backend.getKeys())[0]).toEqual(keyBefore);
  });

  it('purgeExpiredTrash: 30일 지난 휴지통 메모는 내용을 비우고 tombstone만 남긴다', async () => {
    const s = make();
    await s.setup('pw');
    const old = await s.save({ title: '오래된 삭제', body: '비밀' });
    const fresh = await s.save({ title: '최근 삭제', body: '아직' });
    await s.delete(old.id);
    await s.delete(fresh.id);
    expect(s.listDeleted()).toHaveLength(2);
    // 29일 뒤: 아무것도 안 비움
    expect(await s.purgeExpiredTrash(Date.now() + 29 * 86_400_000)).toBe(0);
    // old만 31일 전에 삭제된 것처럼: deletedAt을 과거로 둔 사본을 병합
    const oldDeleted = s.listDeleted().find((n) => n.id === old.id)!;
    await s.mergeNotes([{ ...oldDeleted, deletedAt: null, updatedAt: '2999-01-01T00:00:00.000Z' }]);
    await s.delete(old.id);
    const n = await s.purgeExpiredTrash(Date.now() + 31 * 86_400_000);
    expect(n).toBe(2); // 둘 다 31일 지남
    expect(s.listDeleted()).toHaveLength(0); // 내용이 빈 tombstone은 휴지통 목록에서 빠진다
    const blob = await store.getBlob(old.id);
    expect(blob?.deletedAt).not.toBeNull();
    expect(JSON.stringify(await store.allBlobs())).not.toContain('비밀');
    expect((await store.outbox()).filter((e) => e.op === 'delete')).toHaveLength(2);
  });

  it('복구 문구로 unlockWithRecovery → 메모 복원', async () => {
    const s = make();
    const { recoveryPhrase } = await s.setup('pw');
    const n = await s.save({ title: '복구', body: '' });
    s.lock();
    await s.unlockWithRecovery(recoveryPhrase);
    expect(s.get(n.id)?.title).toBe('복구');
  });
});
