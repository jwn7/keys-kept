/**
 * 키 생성기 (docs/STRATEGY.md 계획 9).
 * 세션 비밀값·웹훅 비밀값·데이터베이스 비밀번호처럼 "내가 정하는" 값을 만든다.
 * 난수는 플랫폼의 암호용 난수(`crypto.getRandomValues`)에서만 받는다. 직접 만든 난수 알고리즘은 없다.
 */
export type GenerateKind = 'hex' | 'base64url' | 'password';

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.~';
// 헷갈리는 글자(0/O, 1/l/I)는 뺐다. 손으로 옮겨 적을 일이 있어서다. 기호는 주소·셸·.env에서 따옴표 없이 쓸 수 있는 것만.

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * - hex: 바이트 수를 size로 (기본 32 → 64글자)
 * - base64url: 바이트 수를 size로 (기본 32 → 43글자). 주소와 .env에 그대로 쓸 수 있다
 * - password: 글자 수를 size로 (기본 24)
 */
export function generateSecret(kind: GenerateKind, size?: number): string {
  if (kind === 'hex') return [...randomBytes(size ?? 32)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (kind === 'base64url') {
    let s = '';
    for (const b of randomBytes(size ?? 32)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // 글자 고르기: 256을 글자 수로 나눈 나머지를 그냥 쓰면 앞쪽 글자가 더 자주 나온다(치우침).
  // 그래서 글자 수의 배수를 넘는 바이트는 버리고 다시 뽑는다.
  const n = PASSWORD_CHARS.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < (size ?? 24)) {
    for (const b of randomBytes(32)) {
      if (b < limit && out.length < (size ?? 24)) out += PASSWORD_CHARS[b % n];
    }
  }
  return out;
}
