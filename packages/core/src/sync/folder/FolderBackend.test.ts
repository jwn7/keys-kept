import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ready } from '../../crypto/sodium';
import { LocalStore } from '../../store/LocalStore';
import { VaultSession } from '../../session/VaultSession';
import { fastKdfParams } from '../../test/params';
import { ConflictError } from '../SyncBackend';
import { FolderBackend, MemoryFolderFs } from './FolderBackend';
import type { EncryptedItem } from '../../model/types';

beforeAll(ready);

const item = (id: string, version: number, updatedAt: string): EncryptedItem => ({
  id, type: 'note', itemsKeyId: 'k', nonce: 'n', ciphertext: 'c', aad: { v: 1, id, type: 'note' }, version, updatedAt, deletedAt: null, deviceId: 'd',
});

describe('FolderBackend: 폴더 하나를 저장소로', () => {
  it('넣고, 읽고, 바뀐 것만 시각순으로 받는다', async () => {
    const fs = new MemoryFolderFs();
    const b = new FolderBackend({ fs });
    await b.put(item('a', 1, '2026-11-01T00:00:00.000Z'));
    await b.put(item('b', 1, '2026-11-03T00:00:00.000Z'));
    await b.put(item('c', 1, '2026-11-02T00:00:00.000Z'));
    expect([...fs.files.keys()].sort()).toEqual(['a.enc', 'b.enc', 'c.enc']);
    expect((await b.list(null)).map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect((await b.list('2026-11-01T12:00:00.000Z')).map((i) => i.id)).toEqual(['c', 'b']);
    expect((await b.get('a'))?.version).toBe(1);
    expect(await b.get('none')).toBeNull();
  });

  it('더 높은 버전이 이미 있으면 덮어쓰지 않고 충돌로 알린다', async () => {
    const b = new FolderBackend({ fs: new MemoryFolderFs() });
    await b.put(item('a', 3, '2026-11-03T00:00:00.000Z'));
    await expect(b.put(item('a', 2, '2026-11-04T00:00:00.000Z'))).rejects.toBeInstanceOf(ConflictError);
    expect((await b.get('a'))?.version).toBe(3);
  });

  it('삭제는 파일을 지우지 않고 표시만 남긴다. 전부 지우기는 계정 삭제에서만', async () => {
    const fs = new MemoryFolderFs();
    const b = new FolderBackend({ fs });
    await b.put(item('a', 1, '2026-11-01T00:00:00.000Z'));
    await b.delete('a', '2026-11-05T00:00:00.000Z');
    expect(await b.get('a')).toMatchObject({ deletedAt: '2026-11-05T00:00:00.000Z', version: 2 });
    fs.files.set('사진.jpg', 'not ours');
    await b.purgeAll();
    expect([...fs.files.keys()]).toEqual(['사진.jpg']); // 우리 파일만 지운다
  });

  it('깨진 파일, 남의 파일, 이름과 내용이 안 맞는 파일은 없는 것으로 본다', async () => {
    const fs = new MemoryFolderFs();
    const b = new FolderBackend({ fs });
    fs.files.set('half.enc', '{"id":"half","ciph'); // 동기화 도구가 쓰는 중
    fs.files.set('readme.txt', 'hello');
    fs.files.set('x.enc', JSON.stringify(item('y', 1, '2026-11-01T00:00:00.000Z'))); // 이름을 바꿔치기한 파일
    await b.put(item('ok', 1, '2026-11-01T00:00:00.000Z'));
    expect((await b.list(null)).map((i) => i.id)).toEqual(['ok']);
  });

  it('경로 글자가 든 id는 받지 않는다 (폴더 밖을 건드리지 못하게)', async () => {
    const fs = new MemoryFolderFs();
    const b = new FolderBackend({ fs });
    await expect(b.put(item('../evil', 1, '2026-11-01T00:00:00.000Z'))).rejects.toThrow();
    expect(await b.get('../evil')).toBeNull();
    expect(fs.files.size).toBe(0);
  });
});

describe('FolderBackend로 두 기기 동기화', () => {
  let storeA: LocalStore;
  let storeB: LocalStore;
  beforeEach(() => {
    storeA = new LocalStore(`fa-${Math.random()}`);
    storeB = new LocalStore(`fb-${Math.random()}`);
  });
  afterEach(async () => {
    await storeA.destroy();
    await storeB.destroy();
  });

  it('같은 폴더를 보는 두 기기가 같은 비밀번호로 열고 서로의 키를 받는다. 폴더에는 암호문만 있다', async () => {
    const fs = new MemoryFolderFs();
    const A = new VaultSession({ store: storeA, backend: new FolderBackend({ fs }), deviceId: 'pc', kdfParams: fastKdfParams });
    const B = new VaultSession({ store: storeB, backend: new FolderBackend({ fs }), deviceId: 'laptop', kdfParams: fastKdfParams });
    await A.setup('pw');
    const k = await A.save({ title: 'FOLDER_TEST_KEY', folder: 'shop', secret: { value: 'folder-secret-value-123', env: 'prod', usedIn: ['pc'] } });
    await A.sync();

    await B.unlock('pw'); // 폴더의 vault.json에서 열쇠를 받는다
    await B.sync();
    expect(B.get(k.id)?.secret).toEqual({ value: 'folder-secret-value-123', env: 'prod', usedIn: ['pc'] });

    await B.save({ id: k.id, secret: { value: 'rotated-value-456', env: 'prod', usedIn: ['pc', 'laptop'] } });
    await B.sync();
    await A.sync();
    expect(A.get(k.id)?.secret?.value).toBe('rotated-value-456');

    const everything = [...fs.files.entries()].map(([n, t]) => n + t).join('\n');
    for (const plain of ['FOLDER_TEST_KEY', 'folder-secret-value-123', 'rotated-value-456', 'shop', 'laptop"]']) expect(everything).not.toContain(plain);
    expect([...fs.files.keys()]).toContain('vault.json');
  });
});
