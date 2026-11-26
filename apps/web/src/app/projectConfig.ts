import { envForProject, isSecret, secretIssues, type Note, type SecretIssue } from '@vault/core';

/**
 * 프로젝트 = 폴더 (docs/STRATEGY.md 계획 14, 15). 여기는 화면 없이 도는 순수 함수만 둔다.
 * - 프로젝트 목록과 카드에 보일 수
 * - 코드 폴더의 `.vault.yml` 읽기·쓰기 (아래에 적은 작은 부분집합만. 의존성을 늘리지 않으려고 직접 읽는다)
 * - `.git/HEAD`에서 지금 브랜치, 브랜치 → 환경
 * - `.vault/ai-log.jsonl` (AI 도구가 남긴 사용 기록) 읽기
 */

// ---------- 프로젝트 목록 ----------

export type ProjectSummary = {
  /** null = 프로젝트를 정하지 않은 항목들("프로젝트 없음") */
  name: string | null;
  envs: string[];
  keys: number;
  /** 키가 아닌 항목(예전 메모). 프로젝트 화면에 그대로 보이고 키로 바꿀 수 있다 */
  plain: number;
  /** 살펴볼 것이 하나라도 있는 키 수 */
  warnings: number;
};

export function projectSummaries(notes: Note[], today: string): ProjectSummary[] {
  const m = new Map<string | null, ProjectSummary & { envSet: Set<string> }>();
  for (const n of notes) {
    if (n.deletedAt !== null) continue;
    let p = m.get(n.folder);
    if (!p) {
      p = { name: n.folder, envs: [], keys: 0, plain: 0, warnings: 0, envSet: new Set() };
      m.set(n.folder, p);
    }
    if (isSecret(n)) {
      p.keys++;
      if (n.secret.env) p.envSet.add(n.secret.env);
      if (secretIssues(n, today).length > 0) p.warnings++;
    } else p.plain++;
  }
  // 이름 있는 프로젝트는 이름순, "프로젝트 없음"은 맨 뒤
  return [...m.values()]
    .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name, 'ko')))
    .map(({ envSet, ...p }) => ({ ...p, envs: [...envSet].sort() }));
}

/** 살펴볼 키를 이유별로 센다 (프로젝트 목록 위 띠). 한 키에 이유가 둘이면 둘 다 센다. */
export function issueCounts(notes: Note[], today: string): { keys: number; by: Record<SecretIssue, number> } {
  const by: Record<SecretIssue, number> = { 'public-name': 0, expired: 0, expiring: 0, 'live-in-dev': 0 };
  let keys = 0;
  for (const n of notes) {
    if (n.deletedAt !== null) continue;
    const issues = secretIssues(n, today);
    if (issues.length) keys++;
    for (const i of issues) by[i]++;
  }
  return { keys, by };
}

/** .env 파일 이름에서 환경을 짐작한다: `.env.production` → prod, `.env.dev` → dev, `.env` → null. */
export function envFromFileName(name: string): string | null {
  const m = /^\.?env\.([A-Za-z0-9_-]+)$/.exec(name.trim().replace(/\.age$/, ''));
  if (!m) return null;
  const e = m[1]!.toLowerCase();
  if (e === 'example' || e === 'sample' || e === 'template') return null;
  return e === 'production' ? 'prod' : e === 'development' ? 'dev' : e;
}

// ---------- .vault.yml ----------

export type VaultYml = {
  project: string | null;
  /** 값이 없으면 null (AI 연결 여부를 정하지 않음) */
  ai: boolean | null;
  /** 위에서부터 먼저 맞는 줄을 쓴다 */
  branches: [pattern: string, env: string][];
  required: string[];
};

const unquote = (s: string) => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
};
const stripComment = (line: string) => {
  // 따옴표 밖의 `#`부터 끝까지는 주석
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
};

/**
 * `.vault.yml` 읽기. 이 앱과 `vault-run`이 쓰는 모양만 안다:
 * 맨 위 `project:`, `ai:`, `branches:`(들여 쓴 `패턴: 환경`), `required:`(들여 쓴 `- 이름`). 모르는 줄은 건너뛴다.
 */
export function parseVaultYml(text: string): VaultYml {
  const out: VaultYml = { project: null, ai: null, branches: [], required: [] };
  let section: 'branches' | 'required' | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    if (!indented) {
      section = null;
      const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, key, value] = m as unknown as [string, string, string];
      if (key === 'project') out.project = unquote(value) || null;
      else if (key === 'ai') out.ai = /^(true|yes|on)$/i.test(value.trim()) ? true : /^(false|no|off)$/i.test(value.trim()) ? false : null;
      else if (key === 'branches' && !value.trim()) section = 'branches';
      else if (key === 'required' && !value.trim()) section = 'required';
      continue;
    }
    if (section === 'required') {
      const m = /^\s+-\s+(.+)$/.exec(line);
      if (m) out.required.push(unquote(m[1]!));
    } else if (section === 'branches') {
      const m = /^\s+("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(.+)$/.exec(line);
      if (m) out.branches.push([unquote(m[1]!), unquote(m[2]!)]);
    }
  }
  return out;
}

/** 새 `.vault.yml`. 브랜치 줄은 그 프로젝트에 있는 환경만 (main → prod, 나머지 → dev). */
export function buildVaultYml(project: string, envs: string[], required: string[]): string {
  const lines = [`project: ${/^[\w.-]+$/.test(project) ? project : JSON.stringify(project)}`, 'ai: true'];
  const branches: string[] = [];
  if (envs.includes('prod')) branches.push('  main: prod');
  if (envs.includes('dev')) branches.push('  "*": dev');
  if (branches.length) lines.push('branches:', ...branches);
  if (required.length) lines.push('required:', ...required.map((n) => `  - ${n}`));
  return `${lines.join('\n')}\n`;
}

/** `ai:` 줄만 바꾼다. 없으면 `project:` 줄 다음(없으면 맨 위)에 넣는다. 다른 줄과 주석은 그대로 둔다. */
export function setVaultYmlAi(text: string, on: boolean): string {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const value = `ai: ${on ? 'true' : 'false'}`;
  const at = lines.findIndex((l) => /^ai\s*:/.test(l));
  if (at >= 0) {
    const comment = /\s#.*$/.exec(lines[at]!.replace(/^ai\s*:\s*\S*/, ''))?.[0] ?? '';
    lines[at] = value + comment;
  } else {
    const p = lines.findIndex((l) => /^project\s*:/.test(l));
    lines.splice(p >= 0 ? p + 1 : 0, 0, value);
  }
  return lines.join(nl);
}

/** 프로젝트에서 `.vault.yml`의 required로 적을 이름: 환경변수 모양의 키 이름, 이름순, 겹침 없이. */
export function envStyleNames(notes: Note[], project: string | null): string[] {
  const s = new Set<string>();
  for (const n of notes) if (n.deletedAt === null && isSecret(n) && n.folder === project && /^[A-Z_][A-Z0-9_]*$/.test(n.title)) s.add(n.title);
  return [...s].sort();
}

/** required 중 그 환경에서 빠진 이름. 공통 값(환경 없음)이 있으면 있는 것으로 본다. */
export function missingRequired(notes: Note[], project: string | null, env: string | null, required: string[]): string[] {
  const have = new Set(envForProject(notes, { project, env }).map((e) => e.name));
  return required.filter((r) => !have.has(r));
}

// ---------- 브랜치 ----------

/** `.git/HEAD` 내용 → 브랜치 이름. 브랜치가 아니면(커밋을 직접 고른 상태) 짧은 커밋 해시. */
export function branchFromHead(head: string): string | null {
  const t = head.trim();
  const m = /^ref:\s*refs\/heads\/(.+)$/.exec(t);
  if (m) return m[1]!;
  return /^[0-9a-f]{7,40}$/i.test(t) ? t.slice(0, 7) : null;
}

const globToRe = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

/** branches에서 위부터 먼저 맞는 줄의 환경. 맞는 줄이 없으면 null. */
export function envForBranch(branches: VaultYml['branches'], branch: string): string | null {
  for (const [pattern, env] of branches) if (globToRe(pattern).test(branch)) return env;
  return null;
}

// ---------- AI 사용 기록 ----------

export type AiLogEntry = {
  at: string;
  tool: 'list_keys' | 'run_with_keys' | 'request_key';
  command?: string | undefined;
  keys?: string[] | undefined;
  redacted?: number | undefined;
  env?: string | null | undefined;
};

const TOOLS = new Set(['list_keys', 'run_with_keys', 'request_key']);

/** `.vault/ai-log.jsonl`에서 최근 것부터 max개. 깨진 줄과 모르는 모양은 건너뛴다. */
export function parseAiLog(text: string, max = 5): AiLogEntry[] {
  const out: AiLogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at)) || typeof r.tool !== 'string' || !TOOLS.has(r.tool)) continue;
    out.push({
      at: r.at,
      tool: r.tool as AiLogEntry['tool'],
      command: typeof r.command === 'string' ? r.command : undefined,
      keys: Array.isArray(r.keys) ? r.keys.filter((k): k is string => typeof k === 'string') : undefined,
      redacted: typeof r.redacted === 'number' ? r.redacted : undefined,
      env: typeof r.env === 'string' || r.env === null ? (r.env as string | null) : undefined,
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
}

/** 프로젝트에 있는 환경 이름들 (dev, prod …). 이름순. */
export function envsOf(notes: Note[], project: string | null): string[] {
  const s = new Set<string>();
  for (const n of notes) if (n.deletedAt === null && isSecret(n) && n.folder === project && n.secret.env) s.add(n.secret.env);
  return [...s].sort();
}

// ---------- .gitignore: 키 파일이 저장소에 올라가지 않게 ----------

/** 코드 폴더의 .gitignore에 있어야 하는 줄. 키 파일(암호문)과 AI 사용 기록. .vault.yml은 값이 없어 올려도 된다. */
export const KEY_FILE_IGNORES = ['.env*.age', 'env*.age', '.vault/'];

/** .gitignore가 막지 않는 것. 정확히 같은 줄이나 더 넓은 무늬(`*.age`, `.vault`)가 있으면 막는 것으로 본다. 부정(!)은 따지지 않는다. */
export function gitignoreMissing(text: string | null): string[] {
  const lines = new Set((text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  const covered = (want: string) =>
    lines.has(want) || lines.has(`/${want}`) || (want.endsWith('.age') && (lines.has('*.age') || lines.has('/*.age'))) || (want === '.vault/' && (lines.has('.vault') || lines.has('/.vault') || lines.has('/.vault/')));
  return KEY_FILE_IGNORES.filter((w) => !covered(w));
}

/** 빠진 줄을 끝에 붙인 새 .gitignore 내용. 원래 내용은 그대로 둔다. */
export function appendGitignore(text: string | null, missing: string[]): string {
  if (missing.length === 0) return text ?? '';
  const base = text ?? '';
  const sep = base === '' || base.endsWith('\n') ? '' : '\n';
  return `${base}${sep}${base ? '\n' : ''}# Keys Kept: encrypted key files and AI usage log stay out of git\n${missing.join('\n')}\n`;
}
