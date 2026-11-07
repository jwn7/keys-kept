import { sodium } from './sodium';
import { fromBase64, toBase64 } from '../model/codec';
import type { KdfParams } from '../model/types';

export const KEY_BYTES = 32;
const SALT_BYTES = 16; // = sodium.crypto_pwhash_SALTBYTES

/**
 * 비밀번호 → root key (32B). Argon2id, libsodium crypto_pwhash.
 * 같은 password + params → 같은 키. async인 이유: 호출자가 UI 스레드를 막지 않게 워커로 옮길 여지를 남긴다.
 */
export async function deriveKey(password: string, params: KdfParams): Promise<Uint8Array> {
  if (params.alg !== 'argon2id') throw new Error(`unsupported kdf: ${params.alg}`);
  const salt = fromBase64(params.salt);
  if (salt.length !== SALT_BYTES) throw new Error(`salt must be ${SALT_BYTES} bytes`);
  return sodium.crypto_pwhash(
    KEY_BYTES,
    password,
    salt,
    params.opslimit,
    params.memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/**
 * desktop: opslimit 3, memlimit 256MB (libsodium MODERATE)
 * mobile : opslimit 3, memlimit 64MB  (저사양 폰에서 1초 내 — SPEC §6)
 */
export function newKdfParams(profile: 'desktop' | 'mobile'): KdfParams {
  return {
    alg: 'argon2id',
    salt: toBase64(sodium.randombytes_buf(SALT_BYTES)),
    opslimit: 3,
    memlimit: profile === 'desktop' ? 256 * 1024 * 1024 : 64 * 1024 * 1024,
  };
}
