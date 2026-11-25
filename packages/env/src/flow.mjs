// 개발 흐름에 붙이는 부분 (docs/STRATEGY.md 계획 10): 브랜치 → 환경, .env.example 대조, 커밋 전 유출 검사.
// 전부 순수 함수다. 파일을 읽고 git을 부르는 일은 bin 쪽이 한다.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from './index.mjs';

/**
 * `.vault.json`의 `branches`로 지금 브랜치의 환경을 고른다.
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
  const cfgPath = join(cwd, '.vault.json');
  if (existsSync(cfgPath)) {
    let cfg = null;
    try {
      cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch {
      /* 잘못된 설정은 없는 것으로 본다 */
    }
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
