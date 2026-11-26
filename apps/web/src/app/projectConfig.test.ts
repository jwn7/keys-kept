import { describe, expect, it } from 'vitest';
import type { Note } from '@vault/core';
import { branchFromHead, buildVaultYml, envForBranch, envFromFileName, envStyleNames, issueCounts, missingRequired, parseAiLog, parseVaultYml, projectSummaries, setVaultYmlAi } from './projectConfig';

let seq = 0;
const note = (p: Partial<Note>): Note => ({
  id: `n${++seq}`,
  title: '',
  body: '',
  tags: [],
  folder: null,
  pinned: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
  ...p,
});
const key = (title: string, folder: string | null, env: string | null, value = 'v', extra: Partial<Note> = {}) => note({ title, folder, secret: { value, env, usedIn: [] }, ...extra });

describe('프로젝트 목록', () => {
  it('폴더마다 환경, 키 수, 경고 수. 이름 없는 묶음은 맨 뒤, 지운 항목은 세지 않는다', () => {
    const notes = [
      key('A', 'shop', 'dev'),
      key('A', 'shop', 'prod'),
      key('NEXT_PUBLIC_SUPABASE_KEY', 'shop', 'prod', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.xxxxxxxxxxxxxxxxxxxxxxxxxx'),
      key('B', 'blog', null, 'v', { date: '2026-11-20' }),
      note({ title: '옛 메모', folder: null }),
      key('GONE', 'blog', null, 'v', { deletedAt: '2026-11-02T00:00:00.000Z' }),
    ];
    const s = projectSummaries(notes, '2026-11-26');
    expect(s.map((p) => p.name)).toEqual(['blog', 'shop', null]);
    expect(s[0]).toEqual({ name: 'blog', envs: [], keys: 1, plain: 0, warnings: 1 }); // 만료됨
    expect(s[1]).toMatchObject({ envs: ['dev', 'prod'], keys: 3, warnings: 1 });
    expect(s[2]).toMatchObject({ keys: 0, plain: 1 });
    expect(issueCounts(notes, '2026-11-26')).toEqual({ keys: 2, by: { 'public-name': 1, expired: 1, expiring: 0, 'live-in-dev': 0 } });
  });

  it('.env 파일 이름에서 환경을 짐작한다', () => {
    expect(envFromFileName('.env')).toBeNull();
    expect(envFromFileName('.env.production')).toBe('prod');
    expect(envFromFileName('.env.development')).toBe('dev');
    expect(envFromFileName('.env.staging')).toBe('staging');
    expect(envFromFileName('.env.example')).toBeNull();
    expect(envFromFileName('env.dev.age')).toBe('dev');
  });
});

describe('.vault.yml', () => {
  it('새 파일은 정해진 모양 그대로', () => {
    expect(buildVaultYml('shop', ['dev', 'prod'], ['STRIPE_SECRET_KEY'])).toBe('project: shop\nai: true\nbranches:\n  main: prod\n  "*": dev\nrequired:\n  - STRIPE_SECRET_KEY\n');
    expect(buildVaultYml('blog', ['dev'], [])).toBe('project: blog\nai: true\nbranches:\n  "*": dev\n');
    expect(buildVaultYml('개인', [], ['A'])).toBe('project: "개인"\nai: true\nrequired:\n  - A\n');
  });

  it('읽기: 주석, 따옴표, 순서를 지킨 브랜치, required', () => {
    const y = parseVaultYml('# 이 폴더는 금고의 어느 프로젝트인가\nproject: shop\nbranches:\n  main: prod\n  release/*: prod\n  "*": dev # 나머지\n# 실행에 꼭 있어야 하는 이름\nrequired:\n  - STRIPE_SECRET_KEY\n  - DATABASE_URL\n');
    expect(y).toEqual({ project: 'shop', ai: null, branches: [['main', 'prod'], ['release/*', 'prod'], ['*', 'dev']], required: ['STRIPE_SECRET_KEY', 'DATABASE_URL'] });
    expect(parseVaultYml(buildVaultYml('shop', ['dev', 'prod'], ['A'])).ai).toBe(true);
    expect(parseVaultYml('ai: false\r\nproject: "my app"\r\n')).toMatchObject({ ai: false, project: 'my app' });
  });

  it('ai 줄만 바꾸고, 없으면 project 다음에 넣는다', () => {
    expect(setVaultYmlAi('project: shop\nai: true\nrequired:\n  - A\n', false)).toBe('project: shop\nai: false\nrequired:\n  - A\n');
    expect(setVaultYmlAi('# 맨 위 주석\nproject: shop\nbranches:\n  main: prod\n', true)).toBe('# 맨 위 주석\nproject: shop\nai: true\nbranches:\n  main: prod\n');
    expect(setVaultYmlAi('required:\n  - A\n', true)).toBe('ai: true\nrequired:\n  - A\n');
    expect(setVaultYmlAi('project: x\r\nai: yes # 켬\r\n', false)).toBe('project: x\r\nai: false # 켬\r\n');
  });

  it('required와 장부를 환경별로 맞춰 본다 (공통 값은 있는 것으로)', () => {
    const notes = [key('STRIPE_SECRET_KEY', 'shop', 'dev'), key('DATABASE_URL', 'shop', null), key('RESEND_API_KEY', 'shop', 'prod'), key('lower name', 'shop', null)];
    const req = ['STRIPE_SECRET_KEY', 'DATABASE_URL', 'RESEND_API_KEY'];
    expect(missingRequired(notes, 'shop', 'dev', req)).toEqual(['RESEND_API_KEY']);
    expect(missingRequired(notes, 'shop', 'prod', req)).toEqual(['STRIPE_SECRET_KEY']);
    expect(envStyleNames(notes, 'shop')).toEqual(['DATABASE_URL', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY']);
  });
});

describe('브랜치와 AI 기록', () => {
  it('.git/HEAD → 브랜치, 브랜치 → 환경 (위에서부터 먼저 맞는 줄)', () => {
    expect(branchFromHead('ref: refs/heads/feature/pay\n')).toBe('feature/pay');
    expect(branchFromHead('3f2a9c1d0e4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c\n')).toBe('3f2a9c1');
    expect(branchFromHead('garbage')).toBeNull();
    const b: [string, string][] = [['main', 'prod'], ['release/*', 'prod'], ['*', 'dev']];
    expect(envForBranch(b, 'main')).toBe('prod');
    expect(envForBranch(b, 'release/1.2')).toBe('prod');
    expect(envForBranch(b, 'feature/pay')).toBe('dev');
    expect(envForBranch([['main', 'prod']], 'feature/x')).toBeNull();
  });

  it('ai-log.jsonl: 최근 것부터 5개, 깨진 줄은 건너뛴다', () => {
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => JSON.stringify({ at: `2026-11-26T10:0${i}:00Z`, tool: 'run_with_keys', command: `npm test ${i}`, keys: ['A'], redacted: i })),
      '{not json',
      JSON.stringify({ at: 'yesterday', tool: 'list_keys' }),
      JSON.stringify({ at: '2026-11-26T11:00:00Z', tool: 'steal_keys' }),
      JSON.stringify({ at: '2026-11-26T09:00:00Z', tool: 'request_key', keys: ['RESEND_API_KEY'], env: null }),
    ].join('\n');
    const log = parseAiLog(lines);
    expect(log).toHaveLength(5);
    expect(log.map((e) => e.command)).toEqual(['npm test 5', 'npm test 4', 'npm test 3', 'npm test 2', 'npm test 1']);
    expect(parseAiLog(lines, 10).at(-1)).toEqual({ at: '2026-11-26T09:00:00Z', tool: 'request_key', command: undefined, keys: ['RESEND_API_KEY'], redacted: undefined, env: null });
  });
});

import { appendGitignore, gitignoreMissing } from './projectConfig';

describe('.gitignore: 키 파일이 커밋되지 않게', () => {
  it('없거나 비어 있으면 셋 다 빠졌다. 같은 줄·더 넓은 무늬가 있으면 막은 것으로 본다', () => {
    expect(gitignoreMissing(null)).toEqual(['.env*.age', 'env*.age', '.vault/']);
    expect(gitignoreMissing('node_modules\n# .env*.age\n')).toEqual(['.env*.age', 'env*.age', '.vault/']); // 주석은 무시
    expect(gitignoreMissing('*.age\n/.vault\n')).toEqual([]);
    expect(gitignoreMissing('.env*.age\r\n')).toEqual(['env*.age', '.vault/']);
  });
  it('appendGitignore: 원래 내용은 그대로, 빠진 줄만 끝에 붙인다', () => {
    expect(appendGitignore('node_modules', ['.vault/'])).toBe('node_modules\n\n# Keys Kept: encrypted key files and AI usage log stay out of git\n.vault/\n');
    expect(appendGitignore(null, ['.env*.age'])).toBe('# Keys Kept: encrypted key files and AI usage log stay out of git\n.env*.age\n');
    expect(appendGitignore('x\n', [])).toBe('x\n');
    expect(gitignoreMissing(appendGitignore('dist\n', gitignoreMissing('dist\n')))).toEqual([]);
  });
});
