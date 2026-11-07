import { beforeAll, describe, expect, it } from 'vitest';
import { ready } from '../crypto/sodium';
import { newItemsKey } from '../crypto/keys';
import { decryptNote, encryptNote } from '../crypto/item';
import type { Note } from '../model/types';

beforeAll(ready);

describe('bench', () => {
  it('1,000개 메모 복호화 < 1초 (SPEC §6)', () => {
    const k = newItemsKey();
    const items = Array.from({ length: 1000 }, (_, i) => {
      const note: Note = {
        id: crypto.randomUUID(),
        title: `메모 ${i}`,
        body: '본문 '.repeat(200), // 약 1KB
        tags: ['t'],
        folder: null,
        pinned: false,
        createdAt: '2026-11-07T00:00:00.000Z',
        updatedAt: '2026-11-07T00:00:00.000Z',
        deletedAt: null,
      };
      return encryptNote(k, 'key', note, 'dev');
    });
    const t0 = performance.now();
    for (const item of items) decryptNote(k, item);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });
});
