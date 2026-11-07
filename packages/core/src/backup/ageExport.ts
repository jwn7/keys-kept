import { Encrypter } from 'age-encryption';
import type { BackupFile, Note } from '../model/types';

export type ExportOptions = {
  /** scrypt work factor (logN). 기본은 age 기본값. 테스트에서만 낮춘다. */
  scryptWorkFactor?: number;
  exportedAt?: string;
};

/**
 * 전체 메모(복호화) → JSON → age 패스프레이즈 모드. 표준 age 파일이라 `age -d`로 풀린다 (규칙 7).
 * 삭제된 메모(tombstone)는 제외한다.
 */
export async function exportBackup(notes: Note[], passphrase: string, device: string, opts: ExportOptions = {}): Promise<Uint8Array> {
  const file: BackupFile = {
    format: 'vault-backup',
    version: 1,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    device,
    notes: notes.filter((n) => n.deletedAt === null),
  };
  const e = new Encrypter();
  e.setPassphrase(passphrase);
  if (opts.scryptWorkFactor !== undefined) e.setScryptWorkFactor(opts.scryptWorkFactor);
  return e.encrypt(JSON.stringify(file));
}

export function backupFileName(date = new Date()): string {
  return `vault-${date.toISOString().slice(0, 10)}.age`;
}
