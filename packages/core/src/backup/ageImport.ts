import { Decrypter } from 'age-encryption';
import type { BackupFile, Note } from '../model/types';

export class BackupPassphraseError extends Error {
  constructor() {
    super('wrong backup passphrase');
    this.name = 'BackupPassphraseError';
  }
}
export class BackupFormatError extends Error {
  constructor(message = 'not a vault backup') {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/** age 파일 + 패스프레이즈 → BackupFile. format/version을 검사한다 (DATA-MODEL §백업 포맷). */
export async function importBackup(bytes: Uint8Array, passphrase: string): Promise<BackupFile> {
  const head = new TextDecoder().decode(bytes.subarray(0, 21));
  if (head !== 'age-encryption.org/v1') throw new BackupFormatError('not an age file');
  const d = new Decrypter();
  d.addPassphrase(passphrase);
  let text: string;
  try {
    text = await d.decrypt(bytes, 'text');
  } catch {
    throw new BackupPassphraseError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError('backup is not JSON');
  }
  if (!isBackupFile(parsed)) throw new BackupFormatError();
  return parsed;
}

function isBackupFile(v: unknown): v is BackupFile {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.format === 'vault-backup' && o.version === 1 && Array.isArray(o.notes) && o.notes.every(isNote);
}

function isNote(v: unknown): v is Note {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.title === 'string' && typeof o.body === 'string' && typeof o.updatedAt === 'string';
}
