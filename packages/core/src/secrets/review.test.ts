import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ready } from '../crypto/sodium';
import { LocalStore } from '../store/LocalStore';
import { MemoryBackend } from '../sync/MemoryBackend';
import { VaultSession } from '../session/VaultSession';
import { fastKdfParams } from '../test/params';
import { formatEnv, isEnvName, parseEnv } from './envfile';
import { envForProject, envMatrix, planEnvImport } from './ledger';
import { defaultKeyName, detectKey } from './detect';
import type { Note } from '../model/types';

beforeAll(ready);

// 코드 검토에서 나온 결함들. 하나씩 실패하는 입력으로 고정한다.
const note = (p: Partial<Note>): Note => ({
  id: crypto.randomUUID(), title: '', body: '', tags: [], folder: null, pinned: false, date: null, secret: null,
  createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z', deletedAt: null, ...p,
});
const key = (name: string, value: string, env: string | null = null, extra: Partial<Note> = {}) => note({ title: name, folder: 'shop', secret: { value, env, usedIn: [] }, ...extra });

describe('.env: 여러 줄 값', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIabc\nabcd==\n-----END PRIVATE KEY-----';

  it('따옴표 안에서 줄이 바뀌어도 값 하나로 읽는다 (첫 줄만 남고 잘리던 문제)', () => {
    expect(parseEnv(`A=1\nPEM="${pem}"\nB=2`)).toEqual([{ name: 'A', value: '1' }, { name: 'PEM', value: pem }, { name: 'B', value: '2' }]);
    expect(parseEnv(`PEM='${pem}'\nB=2`)).toEqual([{ name: 'PEM', value: pem }, { name: 'B', value: '2' }]);
  });

  it('닫는 따옴표가 끝내 없으면 그 줄만 값으로 본다 (뒤의 줄들을 삼키지 않는다)', () => {
    expect(parseEnv('A="oops\nB=2')).toEqual([{ name: 'A', value: 'oops' }, { name: 'B', value: '2' }]);
  });

  it('쓰기: 역슬래시가 든 값은 작은따옴표로 (dotenv류가 역슬래시를 두 번으로 읽지 않게)', () => {
    expect(formatEnv([{ name: 'P', value: 'C:\dir\file' }])).toBe("P='C:\dir\file'\n");
    const tricky = [{ name: 'A', value: "it's \ here" }, { name: 'B', value: ' padded ' }, { name: 'C', value: pem }, { name: 'D', value: 'a=b#c' }];
    expect(parseEnv(formatEnv(tricky))).toEqual(tricky);
  });
});

describe('환경변수 이름이 아닌 키', () => {
  it('내보낼 때 넣지 않는다 (넣으면 받는 쪽이 그 줄을 버려 조용히 사라진다)', () => {
    const notes = [key('GOOD_NAME', 'a'), key('OpenAI API key', 'b'), key('', 'c'), key('NAME (충돌 사본 — PC 2026-11-25)', 'd')];
    expect(envForProject(notes, { project: 'shop', env: null })).toEqual([{ name: 'GOOD_NAME', value: 'a' }]);
    expect(isEnvName('GOOD_NAME')).toBe(true);
    expect(isEnvName('OpenAI API key')).toBe(false);
  });

  it('이름 없이 값만 붙여 넣은 키에는 환경변수 꼴의 이름을 붙인다', () => {
    const d = detectKey(['sk-', 'proj-', 'a'.repeat(48)].join(''))!;
    expect(defaultKeyName(d)).toBe('OPENAI_API_KEY');
    expect(isEnvName(defaultKeyName(detectKey(['gh', 'p_', 'e'.repeat(36)].join(''))!))).toBe(true);
  });
});

describe('같은 이름이 둘일 때', () => {
  it('붙여 넣은 .env에 같은 이름이 두 번 있으면 마지막 것 하나만 만든다', () => {
    const plan = planEnvImport([], [{ name: 'A', value: '1' }, { name: 'A', value: '2' }], { project: 'shop', env: null });
    expect(plan.create).toEqual([{ title: 'A', folder: 'shop', secret: { value: '2', env: null, usedIn: [] } }]);
  });

  it('이미 겹친 키가 있으면 넣기·꺼내기·비교표가 모두 가장 최근에 고친 것을 본다', () => {
    const old = key('A', 'old', 'dev', { updatedAt: '2026-11-01T00:00:00.000Z' });
    const fresh = key('A', 'fresh', 'dev', { updatedAt: '2026-11-20T00:00:00.000Z' });
    for (const notes of [[old, fresh], [fresh, old]]) {
      expect(envForProject(notes, { project: 'shop', env: 'dev' })).toEqual([{ name: 'A', value: 'fresh' }]);
      expect(envMatrix(notes, 'shop').rows[0]!.cells.dev!.note.id).toBe(fresh.id);
      expect(planEnvImport(notes, [{ name: 'A', value: 'new' }], { project: 'shop', env: 'dev' }).update[0]!.id).toBe(fresh.id);
    }
  });
});

describe('겹치는 저장', () => {
  let store: LocalStore;
  let s: VaultSession;
  beforeEach(async () => {
    store = new LocalStore(`review-${Math.random()}`);
    s = new VaultSession({ store, backend: new MemoryBackend(), deviceId: 'pc-1', kdfParams: fastKdfParams });
    await s.setup('pw');
  });
  afterEach(() => store.destroy());

  it('같은 항목의 다른 칸을 거의 동시에 저장해도 둘 다 남는다 (이름과 값이 따로 저장될 때 하나가 지워지던 문제)', async () => {
    const n = await s.save({ title: '', secret: { value: '', env: null, usedIn: [] } });
    await Promise.all([s.save({ id: n.id, title: 'API_KEY' }), s.save({ id: n.id, secret: { value: 'v1', env: 'prod', usedIn: [] } }), s.save({ id: n.id, body: '설명' })]);
    expect(s.get(n.id)).toMatchObject({ title: 'API_KEY', body: '설명', secret: { value: 'v1', env: 'prod' } });
  });
});
