import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { openEnv, parseEnv as coreParseEnv, sealEnv } from '@vault/core';
// @ts-expect-error 순수 JS 모듈이라 타입 선언이 없다
import { openEnvAge, parseEnv, redact } from '../src/index.mjs';

const bin = (name: string) => fileURLToPath(new URL(`../bin/${name}`, import.meta.url));
// 전부 가짜 값
const SECRET = ['sk-', 'proj-', 'z'.repeat(40)].join('');
const ENTRIES = [
  { name: 'OPENAI_API_KEY', value: SECRET },
  { name: 'DATABASE_URL', value: 'postgres://u:p@host/db' },
  { name: 'MULTI', value: 'line1\nline2' },
];
const PASS = 'env 테스트 비밀번호';
let dir: string;
let file: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vault-env-'));
  file = join(dir, '.env.age');
  writeFileSync(file, await sealEnv(ENTRIES, PASS, { scryptWorkFactor: 10 }));
});

describe('암호화된 .env (age)', () => {
  it('앱(core)이 잠근 것을 패키지가 풀고, 표준 age 파일이다', async () => {
    const bytes = await sealEnv(ENTRIES, PASS, { scryptWorkFactor: 10 });
    expect(new TextDecoder().decode(bytes.subarray(0, 21))).toBe('age-encryption.org/v1');
    expect(new TextDecoder().decode(bytes)).not.toContain(SECRET);
    expect(await openEnvAge(bytes, PASS)).toEqual(ENTRIES);
    expect(await openEnv(bytes, PASS)).toEqual(ENTRIES);
    await expect(openEnvAge(bytes, '틀린 비밀번호')).rejects.toThrow();
  });

  it('패키지의 .env 읽기는 core와 같은 결과를 낸다 (옮겨 적은 구현이 어긋나지 않게)', () => {
    const sample = ['# c', 'A=1', 'export B="x y"', "C='한 글'", 'D=', 'E=v # c', 'F="a#b"', 'G="l1\\nl2"', 'bad line', '  H = z  '].join('\n');
    expect(parseEnv(sample)).toEqual(coreParseEnv(sample));
  });

  it('redact: 값이 찍힌 곳을 이름으로 가린다. 짧은 값은 그대로 둔다', () => {
    const out = redact(`key=${SECRET} url=postgres://u:p@host/db n=1`, [...ENTRIES, { name: 'N', value: '1' }]);
    expect(out).toBe('key=[OPENAI_API_KEY 가림] url=[DATABASE_URL 가림] n=1');
  });
});

describe('vault-run: 풀어서 그 명령의 환경변수로만 넣는다', () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [bin('vault-run.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS, ...env } });

  it('명령이 값을 환경변수로 받는다. 금고 비밀번호는 넘기지 않는다', () => {
    const r = run(['--file', file, '--', process.execPath, '-e', 'console.log(JSON.stringify([process.env.OPENAI_API_KEY, process.env.MULTI, process.env.VAULT_ENV_PASSPHRASE ?? null]))']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([SECRET, 'line1\nline2', null]);
  });

  it('명령의 종료 코드를 그대로 돌려주고, 비밀번호가 틀리면 실행하지 않는다', () => {
    expect(run(['--file', file, '--', process.execPath, '-e', 'process.exit(7)']).status).toBe(7);
    const bad = run(['--file', file, '--', process.execPath, '-e', 'console.log("ran")'], { VAULT_ENV_PASSPHRASE: '틀림' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).not.toContain('ran');
  });
});

describe('vault-mcp: AI에게 이름만 주고 값은 주지 않는다', () => {
  /** 서버를 띄우고 요청을 차례로 보낸 뒤, id별 응답을 돌려준다. */
  async function session(requests: object[]): Promise<Record<number, { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } }>> {
    const child = spawn(process.execPath, [bin('vault-mcp.mjs')], { env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS, VAULT_ENV_FILE: file } });
    const got: Record<number, never> = {};
    let buf = '';
    const done = new Promise<void>((resolve) => {
      child.stdout.on('data', (b: Buffer) => {
        buf += b.toString();
        for (const line of buf.split('\n').slice(0, -1)) {
          const m = JSON.parse(line) as { id: number };
          got[m.id] = m as never;
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
        if (Object.keys(got).length === requests.length) resolve();
      });
    });
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
    await done;
    child.kill();
    return got;
  }
  const call = (id: number, name: string, args: object = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

  it('도구 목록에 값을 돌려주는 도구가 없다', async () => {
    const r = await session([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    expect(r[2]!.result!.tools!.map((t) => t.name)).toEqual(['list_keys', 'run_with_keys', 'request_key']);
  });

  it('list_keys는 이름만, run_with_keys는 값을 넣어 실행하되 출력의 값은 가린다', async () => {
    const r = await session([
      call(1, 'list_keys'),
      call(2, 'run_with_keys', { command: process.execPath, args: ['-e', 'console.log("got " + process.env.OPENAI_API_KEY + " / " + (process.env.DATABASE_URL ?? "none"))'], keys: ['OPENAI_API_KEY'] }),
      call(3, 'run_with_keys', { command: process.execPath, args: ['-e', '1'], keys: ['NOPE'] }),
    ]);
    const all = JSON.stringify(r);
    expect(all).not.toContain(SECRET); // 어떤 응답에도 값이 없다
    expect(r[1]!.result!.content![0]!.text.split('\n')).toEqual(['OPENAI_API_KEY', 'DATABASE_URL', 'MULTI']);
    expect(r[2]!.result!.content![0]!.text).toContain('got [OPENAI_API_KEY 가림] / none'); // 고른 키만 들어갔다
    expect(r[3]!.result!.isError).toBe(true);
  }, 30_000);
});

// @ts-expect-error 순수 JS 모듈이라 타입 선언이 없다
import { findLeaks, missingNames, pickEnvForBranch, resolveEnvFile } from '../src/flow.mjs';

describe('개발 흐름 연결', () => {
  it('브랜치 → 환경: 같은 이름이 먼저, 그다음 더 구체적인 무늬', () => {
    const cfg = { branches: { main: 'prod', 'release/*': 'staging', '*': 'dev' } };
    expect(pickEnvForBranch(cfg, 'main')).toBe('prod');
    expect(pickEnvForBranch(cfg, 'release/1.2')).toBe('staging');
    expect(pickEnvForBranch(cfg, 'feature/login')).toBe('dev');
    expect(pickEnvForBranch({ branches: { main: 'prod' } }, 'feature/x')).toBeNull();
    expect(pickEnvForBranch(null, 'main')).toBeNull();
  });

  it('resolveEnvFile: 브랜치에 맞는 .env.<환경>.age 가 있으면 그것, 없으면 .env.age', () => {
    const d = mkdtempSync(join(tmpdir(), 'vault-flow-'));
    writeFileSync(join(d, '.vault.json'), JSON.stringify({ branches: { main: 'prod', '*': 'dev' } }));
    writeFileSync(join(d, '.env.prod.age'), 'x');
    expect(resolveEnvFile({ cwd: d, branch: 'main' })).toEqual({ file: join(d, '.env.prod.age'), env: 'prod' });
    expect(resolveEnvFile({ cwd: d, branch: 'feature/x' })).toEqual({ file: join(d, '.env.age'), env: null }); // .env.dev.age 가 없다
    expect(resolveEnvFile({ cwd: d, branch: 'main', file: 'given.age' })).toEqual({ file: 'given.age', env: null });
  });

  it('missingNames: .env.example 이 요구하는데 금고에 없는 이름', () => {
    expect(missingNames('OPENAI_API_KEY=\nDATABASE_URL=\n# 설명\nNEW_FLAG=\nSENTRY_DSN=', ENTRIES)).toEqual(['NEW_FLAG', 'SENTRY_DSN']);
  });

  it('findLeaks: 금고의 실제 값이 든 줄과 키 이름만 돌려준다 (값은 돌려주지 않는다)', () => {
    const code = ['const a = 1;', `const key = "${SECRET}";`, 'fetch("postgres://u:p@host/db")', 'const n = "1";'].join('\n');
    const leaks = findLeaks(code, [...ENTRIES, { name: 'SHORT', value: '1' }]);
    expect(leaks).toEqual([{ line: 2, name: 'OPENAI_API_KEY' }, { line: 3, name: 'DATABASE_URL' }]);
    expect(JSON.stringify(leaks)).not.toContain(SECRET);
  });

  it('vault-scan: 값이 든 파일이면 1로 끝나고 값은 찍지 않는다. 깨끗하면 0', () => {
    const bad = join(dir, 'leak.js');
    const good = join(dir, 'ok.js');
    writeFileSync(bad, `export const k = "${SECRET}";\n`);
    writeFileSync(good, 'export const k = process.env.OPENAI_API_KEY;\n');
    const run = (target: string) => spawnSync(process.execPath, [bin('vault-scan.mjs'), '--file', file, target], { encoding: 'utf8', env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS } });
    const r = run(bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('leak.js:1  OPENAI_API_KEY');
    expect(r.stderr).not.toContain(SECRET);
    expect(run(good).status).toBe(0);
  });

  it('vault-check: 빠진 이름이 있으면 1', () => {
    const ex = join(dir, '.env.example');
    writeFileSync(ex, 'OPENAI_API_KEY=\nNEW_FLAG=\n');
    const r = spawnSync(process.execPath, [bin('vault-check.mjs'), '--file', file, '--example', ex], { encoding: 'utf8', env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NEW_FLAG');
    writeFileSync(ex, 'OPENAI_API_KEY=\nDATABASE_URL=\n');
    expect(spawnSync(process.execPath, [bin('vault-check.mjs'), '--file', file, '--example', ex], { encoding: 'utf8', env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS } }).status).toBe(0);
  });
});
