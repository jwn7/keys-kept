import { open, seal } from './aead';
import { DecryptError } from './errors';
import { padPlaintext } from './padding';
import { fromBase64, fromUtf8, toBase64, toUtf8 } from '../model/codec';
import type { EncryptedItem, ItemType, Note } from '../model/types';

/**
 * AAD 바이트. 저장된 item.aad 객체가 아니라 (id, type)에서 매번 다시 만든다 —
 * 키 순서를 고정해 결정적이고, 누가 item.id만 바꿔치기하면 복호화가 실패한다.
 */
function aadBytes(id: string, type: ItemType): Uint8Array {
  return fromUtf8(JSON.stringify({ v: 1, id, type }));
}

/** Note(평문) → EncryptedItem. version은 호출자(VaultSession.save)가 "이전 + 1"로 넘긴다. */
export function encryptNote(
  itemsKey: Uint8Array,
  itemsKeyId: string,
  note: Note,
  deviceId: string,
  version = 1,
): EncryptedItem {
  const type: ItemType = 'note';
  // 길이로 메모를 구분하지 못하게 구간 크기까지 채운 뒤 암호화한다 (padding.ts)
  const { nonce, ciphertext } = seal(itemsKey, padPlaintext(fromUtf8(JSON.stringify(note))), aadBytes(note.id, type));
  return {
    id: note.id,
    type,
    itemsKeyId,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    aad: { v: 1, id: note.id, type },
    version,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
    deviceId,
  };
}

export function decryptNote(itemsKey: Uint8Array, item: EncryptedItem): Note {
  if (item.aad.id !== item.id || item.aad.type !== item.type || item.aad.v !== 1) {
    throw new DecryptError('aad mismatch');
  }
  if (item.type !== 'note') throw new DecryptError(`not a note: ${item.type}`);
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    nonce = fromBase64(item.nonce);
    ciphertext = fromBase64(item.ciphertext);
  } catch {
    throw new DecryptError('bad encoding');
  }
  const plain = open(itemsKey, nonce, ciphertext, aadBytes(item.id, item.type));
  const note = JSON.parse(toUtf8(plain)) as Note;
  if (note.id !== item.id) throw new DecryptError('note id mismatch');
  return note;
}
