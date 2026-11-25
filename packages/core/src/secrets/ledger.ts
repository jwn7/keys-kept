import type { Note, SecretInfo } from '../model/types';
import type { NoteInput } from '../session/VaultSession';
import { detectKey, publicNameWarning } from './detect';
import { isEnvName, type EnvEntry } from './envfile';

/**
 * 키 장부 (docs/STRATEGY.md 계획 2, 6).
 * 키 항목은 `secret`이 있는 메모다: 제목 = 이름(환경변수 이름), 폴더 = 프로젝트, 날짜 = 만료일, 본문 = 설명.
 * 메모와 같은 길로 암호화·동기화·버전 기록·백업된다. 새 저장 형식을 만들지 않았다.
 */

type SecretNote = Note & { secret: SecretInfo };

export function isSecret<T extends Pick<Note, 'secret'>>(n: T): n is T & { secret: SecretInfo } {
  return !!n.secret;
}
const live = (n: Note): n is SecretNote => n.deletedAt === null && isSecret(n);
/** 같은 이름이 겹쳤을 때는 가장 최근에 고친 것을 쓴다. 넣기·꺼내기·비교표가 같은 것을 봐야 한다. */
const newer = (a: SecretNote | undefined | null, b: SecretNote): SecretNote => (a && a.updatedAt >= b.updatedAt ? a : b);

type Scope = { project: string | null; env: string | null };

/**
 * 붙여 넣은 .env를 장부에 넣을 계획. 같은 프로젝트·환경·이름이 이미 있으면 새로 만들지 않고 값만 고친다
 * (같은 .env를 두 번 넣어도 항목이 두 배가 되지 않는다). 쓰이는 곳은 건드리지 않는다.
 */
export function planEnvImport(existing: Note[], entries: EnvEntry[], scope: Scope): { create: NoteInput[]; update: NoteInput[]; unchanged: number } {
  const byName = new Map<string, SecretNote>();
  for (const n of existing) {
    if (live(n) && n.folder === scope.project && n.secret.env === scope.env) byName.set(n.title, newer(byName.get(n.title), n));
  }
  const plan = { create: [] as NoteInput[], update: [] as NoteInput[], unchanged: 0 };
  // 붙여 넣은 글에 같은 이름이 두 번 있으면 마지막 것만 (.env를 읽는 프로그램들도 그렇게 한다)
  const last = new Map(entries.map((e) => [e.name, e.value]));
  for (const [name, value] of last) {
    const found = byName.get(name);
    if (!found) plan.create.push({ title: name, folder: scope.project, secret: { value, env: scope.env, usedIn: [] } });
    else if (found.secret.value === value) plan.unchanged++;
    else plan.update.push({ id: found.id, secret: { value, env: scope.env, usedIn: found.secret.usedIn } });
  }
  return plan;
}

/**
 * 프로젝트 하나를 .env로 꺼낼 목록. 이름순.
 * 환경을 안 정한 값(env: null)은 모든 환경 공통이고, 고른 환경에 같은 이름이 있으면 그쪽이 우선한다.
 */
export function envForProject(notes: Note[], scope: Scope): EnvEntry[] {
  const picked = new Map<string, { note: SecretNote; specific: boolean }>();
  for (const n of notes) {
    if (!live(n) || n.folder !== scope.project) continue;
    // 환경변수 이름이 아닌 것(빈 이름, 띄어쓰기, 충돌 사본)은 넣지 않는다: 넣어도 받는 쪽이 그 줄을 버린다
    if (!isEnvName(n.title)) continue;
    const specific = n.secret.env !== null;
    if (specific && n.secret.env !== scope.env) continue;
    const prev = picked.get(n.title);
    if (!prev || (specific && !prev.specific)) picked.set(n.title, { note: n, specific });
    else if (specific === prev.specific) picked.set(n.title, { note: newer(prev.note, n), specific });
  }
  return [...picked.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, v]) => ({ name, value: v.note.secret.value }));
}

export type MatrixCell = { note: SecretNote; /** own: 그 환경의 값, shared: 공통 값을 물려받음 */ state: 'own' | 'shared' };
export type EnvMatrix = {
  envs: string[];
  rows: { name: string; shared: SecretNote | null; cells: Record<string, MatrixCell | null> }[];
  /** 다른 환경에는 있는데 이 환경에는 없는 것 */
  missing: { name: string; env: string }[];
};

/**
 * 환경 비교표 (docs/STRATEGY.md 계획 8). 프로젝트의 키를 행, 환경을 열로 펼친다.
 * 칸이 비어 있으면(그 환경의 값도, 공통 값도 없으면) 빠진 것이다. 배포하고 나서야 알게 되는 "변수 하나 빠짐"을 미리 본다.
 */
export function envMatrix(notes: Note[], project: string | null): EnvMatrix {
  const mine = notes.filter((n): n is SecretNote => live(n) && n.folder === project);
  const envs = [...new Set(mine.map((n) => n.secret.env).filter((e): e is string => e !== null))].sort();
  const names = [...new Set(mine.map((n) => n.title))].sort();
  const missing: EnvMatrix['missing'] = [];
  const rows = names.map((name) => {
    const pick = (env: string | null) => mine.filter((n) => n.title === name && n.secret.env === env).reduce<SecretNote | null>((a, b) => newer(a, b), null);
    const shared = pick(null);
    const cells: Record<string, MatrixCell | null> = {};
    for (const env of envs) {
      const own = pick(env);
      cells[env] = own ? { note: own, state: 'own' } : shared ? { note: shared, state: 'shared' } : null;
      if (!cells[env]) missing.push({ name, env });
    }
    return { name, shared, cells };
  });
  return { envs, rows, missing };
}

export type SecretIssue = 'public-name' | 'expired' | 'expiring' | 'live-in-dev';

const EXPIRING_DAYS = 14;
const DEV_ENV = /^(dev|development|local|test|staging|개발|로컬|테스트)$/i;

const dayNumber = (key: string) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** 이 키에서 살펴볼 것. today는 `YYYY-MM-DD`. 키가 아닌 메모는 빈 배열. */
export function secretIssues(n: Note, today: string): SecretIssue[] {
  if (!isSecret(n)) return [];
  const out: SecretIssue[] = [];
  if (publicNameWarning(n.title, n.secret.value)) out.push('public-name');
  if (n.date) {
    const left = dayNumber(n.date) - dayNumber(today);
    if (left < 0) out.push('expired');
    else if (left <= EXPIRING_DAYS) out.push('expiring');
  }
  if (n.secret.env && DEV_ENV.test(n.secret.env) && detectKey(n.secret.value)?.mode === 'live') out.push('live-in-dev');
  return out;
}

// ---- 사고 모드 ----

/** 키들이 들어가 있는 곳(기기, 배포 서비스) 목록. 많이 쓰인 순, 같으면 먼저 나온 순. */
export function placesUsed(notes: Note[]): { place: string; count: number }[] {
  const count = new Map<string, number>();
  for (const n of notes) if (live(n)) for (const p of n.secret.usedIn) count.set(p, (count.get(p) ?? 0) + 1);
  return [...count.entries()].map(([place, c]) => ({ place, count: c })).sort((a, b) => b.count - a.count);
}

/**
 * "이 곳이 털렸다" 또는 "이 프로젝트가 새어 나갔다"일 때 바꿔야 할 키.
 * - place: 그 곳에 있다고 적어 둔 키가 affected. 어디에 쓰는지 안 적은 키는 unknown으로 따로 준다.
 *   적어 두지 않은 키를 "안전하다"고 넘기지 않으려는 것이다.
 * - project: 그 프로젝트의 키 전부.
 */
export function compromisedBy(notes: Note[], by: { place: string } | { project: string | null }): { affected: SecretNote[]; unknown: SecretNote[] } {
  const all = notes.filter(live);
  if ('project' in by) return { affected: all.filter((n) => n.folder === by.project), unknown: [] };
  return { affected: all.filter((n) => n.secret.usedIn.includes(by.place)), unknown: all.filter((n) => n.secret.usedIn.length === 0) };
}

/** 화면에 보일 가린 값. 긴 값은 어느 키인지 알아볼 만큼만(앞 4글자), 짧은 값은 길이도 드러내지 않고 전부 가린다. */
export function maskValue(value: string): string {
  if (!value) return '';
  return (value.length >= 20 ? value.slice(0, 4) : '') + '••••••••';
}
