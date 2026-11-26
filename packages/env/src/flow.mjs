// 개발 흐름에 붙이는 부분 (docs/STRATEGY.md 계획 10): 브랜치 → 환경, .env.example 대조, 커밋 전 유출 검사.
// 전부 순수 함수다. 파일을 읽고 git을 부르는 일은 bin 쪽이 한다.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from './index.mjs';

/**
 * 프로젝트 폴더의 `.vault.yml`을 읽는다. 의존성 없이 아래 모양만 알아듣는다(모르는 줄은 무시):
 *   project: shop          이 폴더가 금고의 어느 프로젝트인가
 *   ai: true               false면 AI 도구(MCP)가 이 폴더의 키를 쓰지 못한다
 *   branches:              브랜치 → 환경 (무늬에 * 가능, 위에서부터가 아니라 "정확한 이름 → 긴 무늬" 순)
 *     main: prod
 *     "*": dev
 *   required:              실행에 꼭 있어야 하는 이름 (vault-check가 본다)
 *     - STRIPE_SECRET_KEY
 */
export function parseVaultYml(text) {
  const cfg = { project: null, ai: true, branches: {}, required: [] };
  const unq = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');
  let section = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      section = m && !m[2].trim() ? m[1] : null;
      if (m?.[1] === 'project' && m[2].trim()) cfg.project = unq(m[2]);
      if (m?.[1] === 'ai' && m[2].trim()) cfg.ai = !/^(false|no|off)$/i.test(unq(m[2]));
      continue;
    }
    if (section === 'branches') {
      const m = /^\s+("[^"]*"|'[^']*'|[^:]+):\s*(\S.*)$/.exec(line);
      if (m) cfg.branches[unq(m[1])] = unq(m[2]);
    } else if (section === 'required') {
      const m = /^\s+-\s*(\S.*)$/.exec(line);
      if (m) cfg.required.push(unq(m[1]));
    }
  }
  return cfg;
}

/** 폴더의 설정: `.vault.yml`이 먼저, 없으면 예전 `.vault.json`. 둘 다 없거나 깨졌으면 null. */
export function readVaultConfig(cwd = process.cwd()) {
  const yml = join(cwd, '.vault.yml');
  if (existsSync(yml)) {
    try {
      return { ...parseVaultYml(readFileSync(yml, 'utf8')), source: '.vault.yml' };
    } catch {
      return null;
    }
  }
  const json = join(cwd, '.vault.json');
  if (existsSync(json)) {
    try {
      const c = JSON.parse(readFileSync(json, 'utf8'));
      return { project: c.project ?? null, ai: c.ai !== false, branches: c.branches ?? {}, required: Array.isArray(c.required) ? c.required : [], source: '.vault.json' };
    } catch {
      return null; // 잘못된 설정은 없는 것으로 본다
    }
  }
  return null;
}

/**
 * 설정의 `branches`로 지금 브랜치의 환경을 고른다.
 *   { "branches": { "main": "prod", "release/*": "prod", "*": "dev" } }
 * 정확히 같은 이름이 먼저, 그다음 `*`가 든 무늬 중 긴 것(더 구체적인 것)이 이긴다. 맞는 것이 없으면 null.
 */
export function pickEnvForBranch(config, branch) {
  const map = config?.branches;
  if (!map || !branch) return null;
  if (typeof map[branch] === 'string') return map[branch];
  const patterns = Object.keys(map).filter((k) => k.includes('*')).sort((a, b) => b.length - a.length);
  for (const p of patterns) {
    const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if (re.test(branch)) return map[p];
  }
  return null;
}

export function currentBranch(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null; // git 저장소가 아니거나 git이 없다
  }
}

/**
 * 어느 .env.age를 쓸지. 순서: 직접 준 파일 → VAULT_ENV_FILE → 브랜치에 맞는 `.env.<환경>.age` → `.env.age`.
 * 브랜치로 골랐으면 env에 그 환경 이름을 담아 돌려준다(무엇을 골랐는지 알려 주려고).
 */
export function resolveEnvFile({ file, cwd = process.cwd(), branch } = {}) {
  if (file) return { file, env: null };
  if (process.env.VAULT_ENV_FILE) return { file: process.env.VAULT_ENV_FILE, env: null };
  const cfg = readVaultConfig(cwd);
  if (cfg) {
    const env = pickEnvForBranch(cfg, branch ?? currentBranch(cwd));
    // 브라우저는 내려받을 때 이름 맨 앞의 점을 뗀다(`.env.prod.age` → `env.prod.age`). 둘 다 찾는다.
    for (const name of env ? [`.env.${env}.age`, `env.${env}.age`] : []) {
      if (existsSync(join(cwd, name))) return { file: join(cwd, name), env };
    }
  }
  return { file: !existsSync(join(cwd, '.env.age')) && existsSync(join(cwd, 'env.age')) ? join(cwd, 'env.age') : join(cwd, '.env.age'), env: null };
}

/** `.env.example`이 요구하는 이름 중 금고에 없는 것. */
export function missingNames(exampleText, entries) {
  const have = new Set(entries.map((e) => e.name));
  return parseEnv(exampleText).map((e) => e.name).filter((n) => !have.has(n));
}

/**
 * 글 속에 금고의 값이 그대로 들어 있는 곳. 돌려주는 것은 줄 번호와 키 이름뿐이다(값은 다시 찍지 않는다).
 * 8자 미만인 값은 우연히 겹치는 일이 많아 보지 않는다. 공개해도 되는 값인지는 여기서 모른다: 걸리면 사람이 본다.
 */
export function findLeaks(text, entries, minLength = 8) {
  const out = [];
  const lines = text.split('\n');
  for (const { name, value } of entries) {
    if (value.length < minLength) continue;
    lines.forEach((line, i) => {
      if (line.includes(value)) out.push({ line: i + 1, name });
    });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** GitHub Actions 비밀값 이름 규칙: 영문·숫자·밑줄, 숫자로 시작 불가, `GITHUB_`로 시작 불가. */
export function isGithubSecretName(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^GITHUB_/i.test(name);
}

/** `gh secret set`에 줄 인자. 값은 여기 없다: 표준 입력으로 넘긴다. */
export function ghSecretArgs(name, { repo, env } = {}) {
  return ['secret', 'set', name, ...(repo ? ['--repo', repo] : []), ...(env ? ['--env', env] : [])];
}
