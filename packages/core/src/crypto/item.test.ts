import { beforeAll, describe, expect, it } from 'vitest';
import { ready } from './sodium';
import { newItemsKey } from './keys';
import { decryptNote, encryptNote } from './item';
import { DecryptError } from './errors';
import type { Note } from '../model/types';

beforeAll(ready);

const note: Note = {
  id: '6f1c2a3e-1111-4222-8333-444455556666',
  title: 'Supabase RLS 정책 메모',
  body: '# Supabase RLS\n\n`user_id = auth.uid()` #업무 [[장보기]]',
  tags: ['업무'],
  folder: '업무',
  pinned: true,
  createdAt: '2026-11-07T01:00:00.000Z',
  updatedAt: '2026-11-07T02:00:00.000Z',
  deletedAt: null,
};

describe('item', () => {
  it('encryptNote → EncryptedItem: 평문 필드가 하나도 없다', () => {
    const item = encryptNote(newItemsKey(), 'key-1', note, 'dev-1');
    const json = JSON.stringify(item);
    expect(json).not.toContain('Supabase');
    expect(json).not.toContain('업무');
    expect(json).not.toContain('장보기');
    expect(item).toMatchObject({
      id: note.id,
      type: 'note',
      itemsKeyId: 'key-1',
      aad: { v: 1, id: note.id, type: 'note' },
      version: 1,
      updatedAt: note.updatedAt,
      deletedAt: null,
      deviceId: 'dev-1',
    });
  });

  it('라운드트립', () => {
    const k = newItemsKey();
    const item = encryptNote(k, 'key-1', note, 'dev-1', 7);
    expect(item.version).toBe(7);
    expect(decryptNote(k, item)).toEqual(note);
  });

  it('deletedAt·updatedAt는 평문 메타로 복사된다 (정렬·증분 동기화용)', () => {
    const deleted = { ...note, deletedAt: '2026-11-08T00:00:00.000Z' };
    const item = encryptNote(newItemsKey(), 'key-1', deleted, 'dev-1');
    expect(item.deletedAt).toBe(deleted.deletedAt);
  });

  it('다른 itemsKey → DecryptError', () => {
    const item = encryptNote(newItemsKey(), 'key-1', note, 'dev-1');
    expect(() => decryptNote(newItemsKey(), item)).toThrow(DecryptError);
  });

  it('id 바꿔치기 → DecryptError (AAD가 id를 묶는다)', () => {
    const k = newItemsKey();
    const item = encryptNote(k, 'key-1', note, 'dev-1');
    const swapped = { ...item, id: '00000000-0000-4000-8000-000000000000' };
    expect(() => decryptNote(k, swapped)).toThrow(DecryptError);
  });

  it('aad.id와 item.id가 다르면 복호화 시도 전에 DecryptError', () => {
    const k = newItemsKey();
    const item = encryptNote(k, 'key-1', note, 'dev-1');
    const bad = { ...item, aad: { ...item.aad, id: 'other' } };
    expect(() => decryptNote(k, bad)).toThrow(DecryptError);
  });

  it('ciphertext 변조 → DecryptError', () => {
    const k = newItemsKey();
    const item = encryptNote(k, 'key-1', note, 'dev-1');
    const c = item.ciphertext;
    const tampered = { ...item, ciphertext: (c[0] === 'A' ? 'B' : 'A') + c.slice(1) };
    expect(() => decryptNote(k, tampered)).toThrow(DecryptError);
  });
});
