import type { KdfParams } from '../model/types';
import { sodium } from '../crypto/sodium';

/** 테스트 전용: Argon2id를 가장 가볍게. 결정성·오류 경로는 파라미터와 무관하다. */
export function fastKdfParams(salt?: Uint8Array): KdfParams {
  return {
    alg: 'argon2id',
    salt: sodium.to_base64(salt ?? sodium.randombytes_buf(16), sodium.base64_variants.ORIGINAL),
    opslimit: sodium.crypto_pwhash_OPSLIMIT_MIN,
    memlimit: sodium.crypto_pwhash_MEMLIMIT_MIN,
  };
}
