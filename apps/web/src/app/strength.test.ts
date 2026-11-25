import { describe, expect, it } from 'vitest';
import { strongScore } from './strength';

describe('strongScore (zxcvbn)', () => {
  it('흔한 비밀번호와 키보드 배열은 길어도 약하다', async () => {
    expect(await strongScore('password1234')).toBeLessThan(3);
    expect(await strongScore('qwertyuiop12')).toBeLessThan(3);
    expect(await strongScore('aaaaaaaaaaaaaaaa')).toBeLessThan(3);
  });
  it('무관한 단어 여러 개를 이은 문장은 강하다', async () => {
    expect(await strongScore('보라색 자전거 달력 소나무')).toBeGreaterThanOrEqual(3);
    expect(await strongScore('purple bicycle calendar pine 42')).toBeGreaterThanOrEqual(3);
  });
  it('빈 값은 0', async () => {
    expect(await strongScore('')).toBe(0);
  });
});
