import { beforeAll, describe, expect, it } from 'vitest';
import { ready } from '../crypto/sodium';
import { fromBase64, fromUtf8, toBase64, toUtf8 } from './codec';

beforeAll(ready);

describe('codec', () => {
  it('base64 라운드트립 (표준 변형, 패딩 포함)', () => {
    const b = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const s = toBase64(b);
    expect(s).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(fromBase64(s)).toEqual(b);
  });
  it('utf8 라운드트립 (한글·이모지)', () => {
    expect(toUtf8(fromUtf8('메모 📝'))).toBe('메모 📝');
  });
  it('잘못된 base64 → throw', () => {
    expect(() => fromBase64('***')).toThrow();
  });
});
