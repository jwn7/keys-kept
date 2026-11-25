import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { ready } from '../crypto/sodium';
import { LocalStore } from '../store/LocalStore';
import { MemoryBackend } from '../sync/MemoryBackend';
import { VaultSession } from '../session/VaultSession';
import { fastKdfParams } from '../test/params';
import { exportObsidianZip } from '../backup/obsidianExport';
import { compromisedBy, envForProject, isSecret, maskValue, placesUsed, planEnvImport, secretIssues } from './ledger';
import type { Note } from '../model/types';

beforeAll(ready);

// 전부 가짜 값. 진짜처럼 보이는 키를 그대로 적으면 비밀 검사기가 막으므로 이어 붙여 만든다.
const OPENAI = ['sk-', 'proj-', 'a'.repeat(48)].join('');
const STRIPE_LIVE = ['sk', '_live_', 'b'.repeat(24)].join('');

const note = (p: Partial<Note>): Note => ({
  id: crypto.randomUUID(), title: '', body: '', tags: [], folder: null, pinned: false, date: null, secret: null,
  createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z', deletedAt: null, ...p,
});
const key = (name: string, value: string, project: string | null = 'shop', env: string | null = null, extra: Partial<Note> = {}) =>
  note({ title: name, folder: project, secret: { value, env, usedIn: [] }, ...extra });

describe('키 항목: 메모에 값·환경·쓰이는 곳을 담는다', () => {
  let store: LocalStore;
  let s: VaultSession;
  beforeEach(async () => {
    store = new LocalStore(`ledger-${Math.random()}`);
    s = new VaultSession({ store, backend: new MemoryBackend(), deviceId: 'pc-1', kdfParams: fastKdfParams });
    await s.setup('pw');
  });
  afterEach(() => store.destroy());

  it('저장하고 다시 읽는다. 값은 암호문 안에만 있다', async () => {
    const n = await s.save({ title: 'OPENAI_API_KEY', folder: 'shop', date: '2027-01-31', secret: { value: OPENAI, env: 'prod', usedIn: ['맥북', 'Vercel'] } });
    expect(s.get(n.id)?.secret).toEqual({ value: OPENAI, env: 'prod', usedIn: ['맥북', 'Vercel'] });
    expect(isSecret(n)).toBe(true);
    const raw = JSON.stringify(await s.rawItem(n.id));
    expect(raw).not.toContain(OPENAI);
    expect(raw).not.toContain('OPENAI_API_KEY');
    expect(raw).not.toContain('Vercel');

    s.lock();
    await s.unlock('pw');
    expect(s.get(n.id)?.secret?.value).toBe(OPENAI);
  });

  it('다른 필드만 고치면 값은 그대로, null을 주면 보통 메모가 된다', async () => {
    const n = await s.save({ title: 'KEY', secret: { value: 'v1', env: null, usedIn: [] } });
    expect((await s.save({ id: n.id, body: '결제용' })).secret?.value).toBe('v1');
    expect((await s.save({ id: n.id, pinned: true })).secret?.value).toBe('v1');
    const cleared = await s.save({ id: n.id, secret: null });
    expect(cleared.secret).toBeNull();
    expect(isSecret(cleared)).toBe(false);
  });

  it('값을 바꿔도 이전 값은 버전 기록에 남고, 되돌리면 값도 돌아온다 (잘못 바꿨을 때)', async () => {
    const n = await s.save({ title: 'KEY', secret: { value: 'old-value', env: null, usedIn: [] } }, { snapshot: true });
    await s.save({ id: n.id, secret: { value: 'new-value', env: null, usedIn: [] } }, { snapshot: true });
    const first = (await s.history(n.id)).find((h) => h.note.secret?.value === 'old-value');
    expect(first).toBeDefined();
    expect((await s.revert(n.id, first!.version)).secret?.value).toBe('old-value');
  });

  it('휴지통 30일 정리는 값도 비운다', async () => {
    const n = await s.save({ title: 'KEY', secret: { value: OPENAI, env: null, usedIn: ['맥북'] } });
    await s.delete(n.id);
    await s.purgeExpiredTrash(Date.now() + 31 * 86_400_000);
    expect(s.listDeleted().find((x) => x.id === n.id)?.secret ?? null).toBeNull();
  });

  it('평문 내보내기(옵시디언 zip)에는 값을 넣지 않는다', () => {
    const zip = unzipSync(exportObsidianZip([key('OPENAI_API_KEY', OPENAI, 'shop', 'prod', { body: '결제 서버에서 씀' })]));
    const text = Object.values(zip).map((b) => strFromU8(b)).join('\n');
    expect(text).not.toContain(OPENAI);
    expect(text).toContain('결제 서버에서 씀'); // 설명은 나간다
    expect(text).toContain('secret: true');
  });
});

describe('.env 넣기: 같은 프로젝트·환경·이름이면 새로 만들지 않고 값을 고친다', () => {
  const existing = [key('API_KEY', 'old', 'shop', 'dev'), key('SAME', 'x', 'shop', 'dev'), key('API_KEY', 'other-project', 'blog', 'dev'), key('API_KEY', 'prod-value', 'shop', 'prod')];
  const entries = [{ name: 'API_KEY', value: 'new' }, { name: 'SAME', value: 'x' }, { name: 'NEW_ONE', value: 'n' }];

  it('만들 것, 고칠 것, 그대로인 것을 나눈다', () => {
    const plan = planEnvImport(existing, entries, { project: 'shop', env: 'dev' });
    expect(plan.create).toEqual([{ title: 'NEW_ONE', folder: 'shop', secret: { value: 'n', env: 'dev', usedIn: [] } }]);
    expect(plan.update).toEqual([{ id: existing[0]!.id, secret: { value: 'new', env: 'dev', usedIn: [] } }]);
    expect(plan.unchanged).toBe(1);
  });

  it('고칠 때 쓰이는 곳은 지우지 않는다', () => {
    const withUse = [key('API_KEY', 'old', 'shop', 'dev', { secret: { value: 'old', env: 'dev', usedIn: ['맥북'] } })];
    expect(planEnvImport(withUse, [{ name: 'API_KEY', value: 'new' }], { project: 'shop', env: 'dev' }).update[0]!.secret).toEqual({ value: 'new', env: 'dev', usedIn: ['맥북'] });
  });

  it('휴지통에 있는 것은 없는 것으로 본다', () => {
    const trashed = [key('API_KEY', 'old', 'shop', 'dev', { deletedAt: '2026-11-25T00:00:00.000Z' })];
    expect(planEnvImport(trashed, [{ name: 'API_KEY', value: 'new' }], { project: 'shop', env: 'dev' }).create).toHaveLength(1);
  });
});

describe('.env 꺼내기', () => {
  const notes = [
    key('B_KEY', 'b-dev', 'shop', 'dev'),
    key('A_KEY', 'a-shared', 'shop', null), // 환경을 안 정한 값 = 모든 환경 공통
    key('B_KEY', 'b-prod', 'shop', 'prod'),
    key('C_KEY', 'c-shared', 'shop', null),
    key('C_KEY', 'c-prod', 'shop', 'prod'),
    key('X_KEY', 'other', 'blog', 'dev'),
    key('GONE', 'deleted', 'shop', 'dev', { deletedAt: '2026-11-25T00:00:00.000Z' }),
    note({ title: '그냥 메모', folder: 'shop' }),
  ];

  it('프로젝트와 환경을 고르면 이름순으로. 그 환경의 값이 공통 값보다 우선한다', () => {
    expect(envForProject(notes, { project: 'shop', env: 'prod' })).toEqual([
      { name: 'A_KEY', value: 'a-shared' },
      { name: 'B_KEY', value: 'b-prod' },
      { name: 'C_KEY', value: 'c-prod' },
    ]);
    expect(envForProject(notes, { project: 'shop', env: 'dev' })).toEqual([
      { name: 'A_KEY', value: 'a-shared' },
      { name: 'B_KEY', value: 'b-dev' },
      { name: 'C_KEY', value: 'c-shared' },
    ]);
  });
});

describe('살펴볼 것 표시', () => {
  it('공개되는 이름에 비밀 키', () => {
    expect(secretIssues(key('NEXT_PUBLIC_OPENAI_KEY', OPENAI), '2026-11-25')).toContain('public-name');
    expect(secretIssues(key('OPENAI_API_KEY', OPENAI), '2026-11-25')).toEqual([]);
  });

  it('만료: 지났으면 expired, 14일 안이면 expiring', () => {
    expect(secretIssues(key('K', 'v', 'p', null, { date: '2026-11-24' }), '2026-11-25')).toEqual(['expired']);
    expect(secretIssues(key('K', 'v', 'p', null, { date: '2026-12-09' }), '2026-11-25')).toEqual(['expiring']);
    expect(secretIssues(key('K', 'v', 'p', null, { date: '2026-12-10' }), '2026-11-25')).toEqual([]);
    expect(secretIssues(note({ title: '메모', date: '2026-11-01' }), '2026-11-25')).toEqual([]); // 키가 아니면 보지 않는다
  });

  it('운영용 키가 개발 환경에 들어 있으면 알린다', () => {
    expect(secretIssues(key('STRIPE_SECRET_KEY', STRIPE_LIVE, 'shop', 'dev'), '2026-11-25')).toEqual(['live-in-dev']);
    expect(secretIssues(key('STRIPE_SECRET_KEY', STRIPE_LIVE, 'shop', 'prod'), '2026-11-25')).toEqual([]);
  });
});

describe('사고 모드: 털린 곳에 있던 키만 고른다', () => {
  const notes = [
    key('A', 'a', 'shop', 'prod', { secret: { value: 'a', env: 'prod', usedIn: ['맥북', 'Vercel'] } }),
    key('B', 'b', 'shop', 'dev', { secret: { value: 'b', env: 'dev', usedIn: ['맥북'] } }),
    key('C', 'c', 'blog', null, { secret: { value: 'c', env: null, usedIn: ['Vercel'] } }),
    key('D', 'd', 'blog', null), // 어디에 쓰는지 안 적은 키
    key('E', 'e', 'shop', null, { secret: { value: 'e', env: null, usedIn: ['맥북'] }, deletedAt: '2026-11-25T00:00:00.000Z' }),
  ];

  it('쓰이는 곳 목록을 많이 쓰인 순으로 모은다', () => {
    expect(placesUsed(notes)).toEqual([{ place: '맥북', count: 2 }, { place: 'Vercel', count: 2 }]);
  });

  it('기기를 고르면 그 기기에 있던 키. 안 적어 둔 키는 따로 알려준다 (모르는 것은 안전하다고 하지 않는다)', () => {
    const r = compromisedBy(notes, { place: '맥북' });
    expect(r.affected.map((n) => n.title)).toEqual(['A', 'B']);
    expect(r.unknown.map((n) => n.title)).toEqual(['D']);
  });

  it('프로젝트를 고르면 그 프로젝트의 키 전부', () => {
    const r = compromisedBy(notes, { project: 'blog' });
    expect(r.affected.map((n) => n.title)).toEqual(['C', 'D']);
    expect(r.unknown).toEqual([]);
  });
});

describe('maskValue: 화면에는 가려서', () => {
  it('긴 값은 앞 4글자만 남긴다 (어느 키인지 알아볼 만큼만)', () => {
    expect(maskValue(OPENAI)).toBe('sk-p••••••••');
    expect(maskValue(OPENAI)).not.toContain('aaaa');
  });
  it('짧은 값은 전부 가린다', () => {
    expect(maskValue('hunter2')).toBe('••••••••');
    expect(maskValue('')).toBe('');
  });
});
