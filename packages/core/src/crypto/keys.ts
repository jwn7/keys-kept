import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sodium } from './sodium';
import { NONCE_BYTES, open, seal } from './aead';
import { DecryptError } from './errors';
import { deriveKey, KEY_BYTES } from './kdf';
import { fromBase64, fromUtf8, toBase64 } from '../model/codec';
import type { KdfParams } from '../model/types';

/**
 * wrap/unwrap의 AAD. 감싼 키 블롭이 "itemsKey 포장"이라는 용도에 묶여,
 * 같은 rootKey로 만든 다른 암호문(미래의 settings 등)을 여기 끼워 넣지 못한다.
 */
const WRAP_AAD = fromUtf8('vault:itemsKey:v1');

export function newItemsKey(): Uint8Array {
  return sodium.randombytes_buf(KEY_BYTES);
}

/** rootKey로 itemsKey를 감싼다 → base64(nonce || ciphertext). */
export function wrap(rootKey: Uint8Array, itemsKey: Uint8Array): string {
  if (itemsKey.length !== KEY_BYTES) throw new Error(`itemsKey must be ${KEY_BYTES} bytes`);
  const { nonce, ciphertext } = seal(rootKey, itemsKey, WRAP_AAD);
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return toBase64(out);
}

export function unwrap(rootKey: Uint8Array, wrapped: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(wrapped);
  } catch {
    throw new DecryptError('bad wrapped key encoding');
  }
  if (bytes.length < NONCE_BYTES + KEY_BYTES) throw new DecryptError('wrapped key too short');
  const nonce = bytes.subarray(0, NONCE_BYTES);
  const ciphertext = bytes.subarray(NONCE_BYTES);
  const key = open(rootKey, nonce, ciphertext, WRAP_AAD);
  if (key.length !== KEY_BYTES) throw new DecryptError('unwrapped key has wrong length');
  return key;
}

/** BIP39 영단어 12개 (128비트 엔트로피 + 4비트 체크섬). */
export function newRecoveryPhrase(): string[] {
  return generateMnemonic(wordlist, 128).split(' ');
}

/**
 * 복구 문구 → recoveryKey (32B). DATA-MODEL.md: "복구키 12단어 ──Argon2id──▶ recoveryKey".
 * 사용자가 종이에 적어둔 값을 손으로 다시 입력하므로, 입력 정규화와 오타 검출을 어디까지 할지가 설계 포인트다.
 */
export async function recoveryKey(phrase: string[], params: KdfParams): Promise<Uint8Array> {
  // 1) 손 입력 정규화: 앞뒤 공백·대소문자·유니코드 변형(스마트 따옴표 등)을 흡수한다.
  const canonical = phrase
    .map((w) => w.normalize('NFKD').trim().toLowerCase())
    .filter((w) => w.length > 0)
    .join(' ');
  // 2) Argon2id(1초)를 돌리기 전에 BIP39 체크섬으로 오타를 잡는다. 어떤 단어인지는 말하지 않는다.
  if (!validateMnemonic(canonical, wordlist)) throw new InvalidRecoveryPhraseError();
  // 3) 정규화된 문구를 "비밀번호"로 보고 Argon2id → 32B (DATA-MODEL.md 키 계층 다이어그램 그대로).
  return deriveKey(canonical, params);
}

/** 복구 문구가 BIP39 형식이 아니거나 체크섬이 맞지 않음. 어떤 단어가 틀렸는지는 알려주지 않는다. */
export class InvalidRecoveryPhraseError extends Error {
  constructor() {
    super('invalid recovery phrase');
    this.name = 'InvalidRecoveryPhraseError';
  }
}
