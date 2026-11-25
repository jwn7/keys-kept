/**
 * 크기 감추기. 암호문의 길이는 평문의 길이를 그대로 드러낸다("이 메모는 12자, 저 메모는 3만 자").
 * 암호화하기 전에 평문을 정해진 구간 크기까지 채워서, 서버가 길이로 메모를 구분하기 어렵게 한다.
 *
 * - 구간은 Padmé 방식: 길이 L의 위쪽 몇 비트만 남기고 올림한다. 늘어나는 양은 최대 약 12%이고,
 *   가능한 크기의 가짓수는 log 수준으로 줄어든다 (Nikitin 외, "Reducing Metadata Leakage from Encrypted Files", PETS 2019).
 * - 짧은 메모가 대부분이므로 최소 구간을 둔다: 256바이트 이하는 전부 같은 크기.
 * - 채우는 값은 공백(0x20)이다. 평문이 JSON이라 뒤의 공백은 `JSON.parse`가 무시한다.
 *   그래서 형식 버전을 올리지 않아도 되고, 채우기 전의 암호문과 채우기를 모르는 옛 앱이 서로 그대로 읽는다.
 * - 채움은 암호문 안에 있으므로 값이 무엇인지는 밖에서 보이지 않는다.
 *
 * 새 암호 알고리즘이 아니라 암호화 앞단의 길이 처리다 (CLAUDE.md 규칙 1은 그대로).
 */
export const MIN_PADDED = 256;

export function paddedLength(len: number): number {
  if (len <= MIN_PADDED) return MIN_PADDED;
  const e = 31 - Math.clz32(len); // floor(log2(len))
  const s = 32 - Math.clz32(e); // floor(log2(e)) + 1: 남길 위쪽 비트 수
  const step = 2 ** (e - s); // 아래 (e - s)비트를 올림
  return Math.ceil(len / step) * step;
}

export function padPlaintext(plain: Uint8Array): Uint8Array {
  const out = new Uint8Array(paddedLength(plain.length)).fill(0x20);
  out.set(plain);
  return out;
}
