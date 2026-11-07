import { beforeAll, describe, expect, it } from 'vitest';
import { ready, sodium } from './sodium';
import { deriveKey, newKdfParams } from './kdf';
import { fastKdfParams } from '../test/params';

beforeAll(ready);

describe('kdf', () => {
  it('같은 password + params → 같은 32B 키 (결정성)', async () => {
    const p = fastKdfParams();
    const a = await deriveKey('correct horse battery staple', p);
    const b = await deriveKey('correct horse battery staple', p);
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
  });

  it('다른 salt → 다른 키', async () => {
    const a = await deriveKey('pw', fastKdfParams());
    const b = await deriveKey('pw', fastKdfParams());
    expect(a).not.toEqual(b);
  });

  it('다른 password → 다른 키', async () => {
    const p = fastKdfParams();
    expect(await deriveKey('pw1', p)).not.toEqual(await deriveKey('pw2', p));
  });

  it('newKdfParams: desktop 256MB, mobile 64MB, opslimit 3, salt 16B', () => {
    const d = newKdfParams('desktop');
    const m = newKdfParams('mobile');
    expect(d.alg).toBe('argon2id');
    expect(d.opslimit).toBe(3);
    expect(d.memlimit).toBe(256 * 1024 * 1024);
    expect(m.opslimit).toBe(3);
    expect(m.memlimit).toBe(64 * 1024 * 1024);
    expect(sodium.from_base64(d.salt, sodium.base64_variants.ORIGINAL)).toHaveLength(16);
    expect(d.salt).not.toBe(m.salt);
  });

  it('mobile 프로파일(64MB)로 실제 유도가 된다', async () => {
    const key = await deriveKey('pw', newKdfParams('mobile'));
    expect(key).toHaveLength(32);
  });

  it('salt 길이가 16B가 아니면 throw', async () => {
    const p = { ...fastKdfParams(), salt: sodium.to_base64(new Uint8Array(8), sodium.base64_variants.ORIGINAL) };
    await expect(deriveKey('pw', p)).rejects.toThrow();
  });
});
