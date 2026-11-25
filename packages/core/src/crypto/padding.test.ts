import { beforeAll, describe, expect, it } from 'vitest';
import { ready } from './sodium';
import { newItemsKey } from './keys';
import { seal } from './aead';
import { decryptNote, encryptNote } from './item';
import { MIN_PADDED, paddedLength, padPlaintext } from './padding';
import { fromBase64, fromUtf8, toBase64 } from '../model/codec';
import type { Note } from '../model/types';

beforeAll(ready);

const note = (body: string): Note => ({
  id: '6f1c2a3e-1111-4222-8333-444455556666',
  title: '제목',
  body,
  tags: [],
  folder: null,
  pinned: false,
  createdAt: '2026-11-25T01:00:00.000Z',
  updatedAt: '2026-11-25T02:00:00.000Z',
  deletedAt: null,
});
const cipherBytes = (n: Note) => fromBase64(encryptNote(newItemsKey(), 'k', n, 'dev').ciphertext).length;

describe('padding (크기 감추기)', () => {
  it('paddedLength: 줄어들지 않고, 최소 구간이 있고, 늘어나는 양은 12% 이하', () => {
    expect(paddedLength(0)).toBe(MIN_PADDED);
    expect(paddedLength(1)).toBe(MIN_PADDED);
    expect(paddedLength(MIN_PADDED)).toBe(MIN_PADDED);
    let prev = 0;
    for (let len = 1; len <= 200_000; len += 7) {
      const p = paddedLength(len);
      expect(p).toBeGreaterThanOrEqual(len);
      expect(p).toBeGreaterThanOrEqual(prev); // 긴 글이 짧은 글보다 작은 구간에 들어가지 않는다
      if (len > MIN_PADDED) expect(p).toBeLessThanOrEqual(Math.ceil(len * 1.12));
      prev = p;
    }
  });

  it('paddedLength: 가능한 크기의 가짓수가 적다 (길이로 구분하기 어렵다)', () => {
    const sizes = new Set<number>();
    for (let len = 1; len <= 100_000; len++) sizes.add(paddedLength(len));
    expect(sizes.size).toBeLessThan(150); // 채우지 않으면 100,000가지
  });

  it('padPlaintext: 뒤를 공백으로 채운다 (JSON 뒤 공백은 해석에 영향이 없다)', () => {
    const p = padPlaintext(fromUtf8('{"a":1}'));
    expect(p.length).toBe(MIN_PADDED);
    expect(JSON.parse(new TextDecoder().decode(p))).toEqual({ a: 1 });
  });

  it('짧은 메모들은 암호문 길이가 같고, 풀면 원래 내용 그대로', () => {
    const a = note('우유');
    const b = note('내일 3시에 치과, 보험 서류 챙기기');
    expect(cipherBytes(a)).toBe(cipherBytes(b));
    expect(cipherBytes(a)).toBe(MIN_PADDED + 16); // + 인증 태그
    const key = newItemsKey();
    expect(decryptNote(key, encryptNote(key, 'k', b, 'dev'))).toEqual(b);
    const long = note('가나다라'.repeat(5000));
    expect(decryptNote(key, encryptNote(key, 'k', long, 'dev'))).toEqual(long);
  });

  it('채우기 전에 만든 암호문(옛 형식)도 그대로 읽는다', () => {
    const key = newItemsKey();
    const n = note('옛 기기가 쓴 메모');
    const padded = encryptNote(key, 'k', n, 'dev');
    const { nonce, ciphertext } = seal(key, fromUtf8(JSON.stringify(n)), fromUtf8(JSON.stringify({ v: 1, id: n.id, type: 'note' })));
    const old = { ...padded, nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
    expect(fromBase64(old.ciphertext).length).toBeLessThan(fromBase64(padded.ciphertext).length);
    expect(decryptNote(key, old)).toEqual(n);
  });
});
