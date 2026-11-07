import { beforeAll, describe, expect, it } from 'vitest';
import { ready, sodium } from './sodium';
import { open, seal } from './aead';
import { DecryptError } from './errors';

beforeAll(ready);

const key = () => sodium.randombytes_buf(32);
const bytes = (s: string) => new TextEncoder().encode(s);

describe('aead', () => {
  it('라운드트립', () => {
    const k = key();
    const { nonce, ciphertext } = seal(k, bytes('안녕 vault'), bytes('aad'));
    expect(nonce).toHaveLength(24);
    expect(ciphertext.length).toBe(bytes('안녕 vault').length + 16);
    expect(open(k, nonce, ciphertext, bytes('aad'))).toEqual(bytes('안녕 vault'));
  });

  it('같은 평문 두 번 → 다른 nonce, 다른 암호문', () => {
    const k = key();
    const a = seal(k, bytes('x'), bytes(''));
    const b = seal(k, bytes('x'), bytes(''));
    expect(a.nonce).not.toEqual(b.nonce);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('암호문 1바이트 변조 → DecryptError', () => {
    const k = key();
    const { nonce, ciphertext } = seal(k, bytes('hello'), bytes('aad'));
    const tampered = new Uint8Array(ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(() => open(k, nonce, tampered, bytes('aad'))).toThrow(DecryptError);
  });

  it('AAD 변경 → DecryptError', () => {
    const k = key();
    const { nonce, ciphertext } = seal(k, bytes('hello'), bytes('aad-1'));
    expect(() => open(k, nonce, ciphertext, bytes('aad-2'))).toThrow(DecryptError);
  });

  it('다른 키 → DecryptError', () => {
    const { nonce, ciphertext } = seal(key(), bytes('hello'), bytes(''));
    expect(() => open(key(), nonce, ciphertext, bytes(''))).toThrow(DecryptError);
  });

  it('키 길이가 32B가 아니면 throw', () => {
    expect(() => seal(new Uint8Array(16), bytes('x'), bytes(''))).toThrow();
  });
});
