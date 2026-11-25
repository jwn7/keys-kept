import { describe, expect, it } from 'vitest';
import { generateSecret } from './generate';
import { envMatrix } from './ledger';
import type { Note } from '../model/types';

const note = (p: Partial<Note>): Note => ({
  id: crypto.randomUUID(), title: '', body: '', tags: [], folder: null, pinned: false, date: null, secret: null,
  createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z', deletedAt: null, ...p,
});
const key = (name: string, value: string, env: string | null, project = 'shop', extra: Partial<Note> = {}) => note({ title: name, folder: project, secret: { value, env, usedIn: [] }, ...extra });

describe('envMatrix: 키를 행, 환경을 열로 펼친다', () => {
  const notes = [
    key('API_URL', 'https://dev', 'dev'),
    key('API_URL', 'https://prod', 'prod'),
    key('STRIPE_KEY', 'sk-test', 'dev'), // prod에 없다
    key('SENTRY_DSN', 'dsn', null), // 공통
    key('FLAG', 'on', 'prod'), // dev에 없다
    key('FLAG', 'shared', null), // 하지만 공통 값이 있어 dev는 그것을 쓴다
    key('OTHER', 'x', 'dev', 'blog'),
    key('GONE', 'x', 'dev', 'shop', { deletedAt: '2026-11-25T00:00:00.000Z' }),
    note({ title: '메모', folder: 'shop' }),
  ];
  const m = envMatrix(notes, 'shop');

  it('환경은 이름순, 행은 키 이름순', () => {
    expect(m.envs).toEqual(['dev', 'prod']);
    expect(m.rows.map((r) => r.name)).toEqual(['API_URL', 'FLAG', 'SENTRY_DSN', 'STRIPE_KEY']);
  });

  it('칸: 그 환경의 값, 없으면 공통 값을 물려받고, 둘 다 없으면 빠짐', () => {
    const row = (name: string) => m.rows.find((r) => r.name === name)!;
    expect(row('API_URL').cells.dev).toMatchObject({ state: 'own' });
    expect(row('API_URL').cells.dev!.note.secret!.value).toBe('https://dev');
    expect(row('FLAG').cells.dev).toMatchObject({ state: 'shared' });
    expect(row('FLAG').cells.dev!.note.secret!.value).toBe('shared');
    expect(row('FLAG').cells.prod).toMatchObject({ state: 'own' });
    expect(row('SENTRY_DSN').cells.prod).toMatchObject({ state: 'shared' });
    expect(row('STRIPE_KEY').cells.prod).toBeNull();
  });

  it('빠진 칸을 센다 (운영에 변수 하나가 빠져서 나는 사고를 미리 본다)', () => {
    expect(m.missing).toEqual([{ name: 'STRIPE_KEY', env: 'prod' }]);
  });

  it('환경을 하나도 안 정한 프로젝트는 열이 없다', () => {
    expect(envMatrix([key('A', '1', null)], 'shop')).toMatchObject({ envs: [], missing: [] });
  });
});

describe('generateSecret', () => {
  it('종류별 길이와 글자', () => {
    expect(generateSecret('hex')).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSecret('hex', 16)).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSecret('base64url')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSecret('password')).toMatch(/^[A-HJ-NP-Za-km-z2-9\-_.~]{24}$/);
    expect(generateSecret('password', 40)).toHaveLength(40);
  });

  it('매번 다르고, 글자가 한쪽으로 치우치지 않는다', () => {
    expect(new Set(Array.from({ length: 50 }, () => generateSecret('base64url'))).size).toBe(50);
    const counts = new Map<string, number>();
    for (const ch of generateSecret('password', 60_000)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const values = [...counts.values()];
    expect(counts.size).toBe(61); // 모든 글자가 나온다 (대문자 24 + 소문자 25 + 숫자 8 + 기호 4)
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.35); // 고르게 (치우치면 2배 가까이 벌어진다)
  });
});
