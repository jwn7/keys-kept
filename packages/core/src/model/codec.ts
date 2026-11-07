import { sodium } from '../crypto/sodium';

/**
 * 바이트 ↔ 문자열 변환은 전부 여기. crypto/는 Uint8Array만 다룬다 (ARCHITECTURE.md 모듈 경계).
 * base64는 표준 변형(패딩 포함) — Drive 파일·Supabase bytea·age 백업 어디서나 그대로 읽힌다.
 */
export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export function fromBase64(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function fromUtf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function toUtf8(bytes: Uint8Array): string {
  return dec.decode(bytes);
}
