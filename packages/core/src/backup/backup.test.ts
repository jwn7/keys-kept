import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { ready } from '../crypto/sodium';
import { backupFileName, exportBackup } from './ageExport';
import { BackupFormatError, BackupPassphraseError, importBackup } from './ageImport';
import { exportObsidianZip, safeFileName } from './obsidianExport';
import { parseMarkdownFiles } from './markdownImport';
import { LocalStore } from '../store/LocalStore';
import { MemoryBackend } from '../sync/MemoryBackend';
import { VaultSession } from '../session/VaultSession';
import { fastKdfParams } from '../test/params';
import type { Note } from '../model/types';

beforeAll(ready);

const note = (over: Partial<Note>): Note => ({
  id: crypto.randomUUID(),
  title: '제목',
  body: '본문',
  tags: [],
  folder: null,
  pinned: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const FAST = { scryptWorkFactor: 10 }; // 테스트용. 실제는 기본값(18)

function hasAgeCli(): boolean {
  try {
    execFileSync('age', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('age 백업', () => {
  it('내보내기 → 가져오기 라운드트립, 삭제된 메모는 제외', async () => {
    const notes = [note({ title: 'a' }), note({ title: 'b', body: '# 안녕 📝' }), note({ title: '지움', deletedAt: '2026-11-03T00:00:00.000Z' })];
    const bytes = await exportBackup(notes, 'backup-pw', 'jwn7-pc', FAST);
    expect(new TextDecoder().decode(bytes.slice(0, 21))).toBe('age-encryption.org/v1');
    expect(new TextDecoder('utf-8', { fatal: false }).decode(bytes)).not.toContain('안녕');

    const file = await importBackup(bytes, 'backup-pw');
    expect(file.format).toBe('vault-backup');
    expect(file.version).toBe(1);
    expect(file.device).toBe('jwn7-pc');
    expect(file.notes.map((n) => n.title).sort()).toEqual(['a', 'b']);
    expect(file.notes.find((n) => n.title === 'b')?.body).toBe('# 안녕 📝');
  });

  it('틀린 패스프레이즈 → BackupPassphraseError', async () => {
    const bytes = await exportBackup([note({})], 'right', 'dev', FAST);
    await expect(importBackup(bytes, 'wrong')).rejects.toThrow(BackupPassphraseError);
  });

  it('age 파일이지만 우리 포맷이 아니면 BackupFormatError', async () => {
    const age = await import('age-encryption');
    const e = new age.Encrypter();
    e.setPassphrase('pw');
    e.setScryptWorkFactor(10);
    const bytes = await e.encrypt(JSON.stringify({ hello: 'world' }));
    await expect(importBackup(bytes, 'pw')).rejects.toThrow(BackupFormatError);
    await expect(importBackup(new Uint8Array([1, 2, 3]), 'pw')).rejects.toThrow(BackupFormatError);
  });

  it('파일명 vault-YYYY-MM-DD.age', () => {
    expect(backupFileName(new Date('2026-11-09T03:00:00Z'))).toBe('vault-2026-11-09.age');
  });

  it.skipIf(!hasAgeCli())('실제 age CLI(age -d)로 복호화돼야 한다 (CI 기준)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vault-age-'));
    try {
      const bytes = await exportBackup([note({ title: 'cli' })], 'cli-pw', 'dev'); // 기본 work factor
      const p = join(dir, 'b.age');
      writeFileSync(p, bytes);
      const out = join(dir, 'b.json');
      execFileSync('age', ['-d', '-o', out, p], { env: { ...process.env, AGE_PASSPHRASE: 'cli-pw' }, input: 'cli-pw\n', stdio: ['pipe', 'ignore', 'ignore'] });
      const parsed = JSON.parse(readFileSync(out, 'utf8')) as { format: string; notes: Note[] };
      expect(parsed.format).toBe('vault-backup');
      expect(parsed.notes[0]?.title).toBe('cli');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('복구 병합 (VaultSession.mergeNotes)', () => {
  let store: LocalStore;
  let s: VaultSession;
  beforeEach(async () => {
    store = new LocalStore(`merge-${Math.random()}`);
    s = new VaultSession({ store, backend: new MemoryBackend(), deviceId: 'd', kdfParams: fastKdfParams });
    await s.setup('pw');
  });
  afterEach(async () => {
    await store.destroy();
  });

  it('id 같으면 updatedAt 큰 쪽, 없으면 추가, 진 쪽은 건너뜀', async () => {
    const mine = await s.save({ title: '내 것', body: '로컬이 더 최신' });
    const older = note({ id: mine.id, title: '내 것', body: '백업이 더 오래됨', updatedAt: '2020-01-01T00:00:00.000Z' });
    const fresh = note({ title: '새 것', body: '백업에만 있음' });
    const r = await s.mergeNotes([older, fresh]);
    expect(r).toEqual({ added: 1, updated: 0, skipped: 1 });
    expect(s.get(mine.id)?.body).toBe('로컬이 더 최신');
    expect(s.get(fresh.id)?.body).toBe('백업에만 있음');

    const newer = note({ id: mine.id, title: '내 것', body: '백업이 더 최신', updatedAt: '2999-01-01T00:00:00.000Z' });
    const r2 = await s.mergeNotes([newer]);
    expect(r2).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(s.get(mine.id)?.body).toBe('백업이 더 최신');
  });
});

describe('옵시디언 내보내기 / 마크다운 가져오기', () => {
  it('safeFileName: 금지 문자는 _', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(safeFileName('   ')).toBe('untitled');
  });

  it('zip: 폴더/제목.md + frontmatter, 제목 중복은 (2)', () => {
    const notes = [
      note({ title: 'Supabase RLS 정책 메모', folder: '업무', tags: ['supabase', '보안'], body: '본문 #supabase [[장보기]]' }),
      note({ title: '장보기', folder: '개인', body: '우유' }),
      note({ title: '장보기', folder: '개인', body: '커피' }),
      note({ title: '폴더 없음', body: 'x' }),
      note({ title: '삭제됨', deletedAt: '2026-11-03T00:00:00.000Z' }),
    ];
    const zip = exportObsidianZip(notes);
    const files = unzipSync(zip);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['개인/장보기 (2).md', '개인/장보기.md', '업무/Supabase RLS 정책 메모.md', '폴더 없음.md']);
    const md = new TextDecoder().decode(files['업무/Supabase RLS 정책 메모.md']);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('tags: [supabase, 보안]');
    expect(md).toContain('created: 2026-11-01T00:00:00.000Z');
    expect(md.trim().endsWith('본문 #supabase [[장보기]]')).toBe(true);
  });

  it('마크다운 파일 → NoteInput: 폴더·제목·frontmatter 태그, 첫 # 제목 우선', () => {
    const inputs = parseMarkdownFiles([
      { path: '업무/회의.md', content: '---\ntags: [a, b]\ncreated: 2026-01-01T00:00:00.000Z\n---\n# 진짜 제목\n본문' },
      { path: '메모.md', content: '그냥 본문 #태그' },
      { path: 'x/y/깊은.md', content: '' },
      { path: 'skip.txt', content: 'no' },
    ]);
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toMatchObject({ title: '진짜 제목', folder: '업무', tags: ['a', 'b'], body: '본문' });
    expect(inputs[1]).toMatchObject({ title: '메모', folder: null, body: '그냥 본문 #태그' });
    expect(inputs[2]).toMatchObject({ title: '깊은', folder: 'x' });
  });
});
