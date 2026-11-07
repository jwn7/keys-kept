import { sodium } from './sodium';
import { DecryptError } from './errors';
import { KEY_BYTES } from './kdf';

export const NONCE_BYTES = 24; // = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES

/**
 * XChaCha20-Poly1305 (IETF). nonce는 매번 24B 랜덤 — 192비트라 카운터 관리 없이 충돌 걱정이 없다.
 * aad는 암호화되지 않지만 인증된다: 바뀌면 open이 실패한다.
 */
export function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes`);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key);
  return { nonce, ciphertext };
}

/** 실패 시 DecryptError (키 틀림 또는 변조 — 구분하지 않는다). */
export function open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) throw new DecryptError('bad key length');
  if (nonce.length !== NONCE_BYTES) throw new DecryptError('bad nonce length');
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key);
  } catch {
    throw new DecryptError();
  }
}
