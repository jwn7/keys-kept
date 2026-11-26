import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    const child = spawn(process.execPath, [bin('vault-mcp.mjs')], { cwd: dir, env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS, VAULT_ENV_FILE: file } }); // 임시 폴더에서 띄운다: 사용 기록(.vault/)이 저장소에 생기지 않게
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

import { newShareIdentity, sealEnvFor } from '@vault/core';

describe('팀원이 내 공개키로 잠가 보낸 파일', () => {
  it('vault-run이 내 개인키 파일로 열어 실행한다. 개인키는 실행하는 프로그램에 넘기지 않는다', async () => {
    const me = await newShareIdentity();
    const shared = join(dir, 'shared.env.age');
    const idFile = join(dir, 'identity.txt');
    writeFileSync(shared, await sealEnvFor(ENTRIES, [me.recipient]));
    writeFileSync(idFile, `# 내 공유 열쇠\n${me.identity}\n`);
    const env = { ...process.env, VAULT_ENV_IDENTITY_FILE: idFile } as Record<string, string>;
    delete env.VAULT_ENV_PASSPHRASE;
    const r = spawnSync(process.execPath, [bin('vault-run.mjs'), '--file', shared, '--', process.execPath, '-e', 'console.log(JSON.stringify([process.env.OPENAI_API_KEY, process.env.VAULT_ENV_IDENTITY_FILE ?? null]))'], { encoding: 'utf8', env });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([SECRET, null]);

    const other = await newShareIdentity();
    writeFileSync(idFile, other.identity);
    expect(spawnSync(process.execPath, [bin('vault-run.mjs'), '--file', shared, '--', process.execPath, '-e', '1'], { encoding: 'utf8', env }).status).toBe(1);
  });
});

// @ts-expect-error 순수 JS 모듈이라 타입 선언이 없다
import { spawnPlan, winQuote } from '../src/index.mjs';

describe('검토에서 나온 결함', () => {
  it('여러 줄 값: core와 같은 결과 (따옴표 안의 줄바꿈)', () => {
    const sample = 'A=1\nPEM="-----BEGIN-----\nMIIabc\nabcd==\n-----END-----"\nS=\'l1\nl2\'\nBAD="oops\nB=2';
    expect(parseEnv(sample)).toEqual(coreParseEnv(sample));
    expect(parseEnv(sample).find((e: { name: string }) => e.name === 'PEM').value).toContain('MIIabc\nabcd==');
  });

  it('winQuote: 공백·따옴표·역슬래시를 감싸고, %이름%은 거절한다', () => {
    expect(winQuote('a b')).toBe('"a b"');
    expect(winQuote('x&echo INJECTED')).toBe('"x&echo INJECTED"');
    expect(winQuote('say "hi"')).toBe('"say \\"hi\\""');
    expect(winQuote('C:\\dir\\')).toBe('"C:\\dir\\\\"');
    expect(() => winQuote('%PATH%')).toThrow();
  });

  it('공백이나 &가 든 인자가 그대로 한 인자로 전달되고, 끼워 넣은 명령은 실행되지 않는다', () => {
    // 확장자 없는 `node`는 Windows에서 셸을 거친다. 그 길에서도 인자가 깨지지 않아야 한다.
    const r = spawnSync(process.execPath, [bin('vault-run.mjs'), '--file', file, '--', 'node', '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a b', 'x&echo INJECTED'], { encoding: 'utf8', env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS } });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim().split('\n')[0]!)).toEqual(['a b', 'x&echo INJECTED']);
    expect(r.stdout).not.toMatch(/^INJECTED/m);
    expect(spawnPlan(process.execPath, ['a b']).shell).toBe(false); // 실행 파일을 직접 가리키면 셸을 쓰지 않는다
  });

  it('vault-run: `--` 없이 --file 을 줘도 명령을 찾는다', () => {
    const r = spawnSync(process.execPath, [bin('vault-run.mjs'), '--file', file, process.execPath, '-e', 'console.log(process.env.DATABASE_URL)'], { encoding: 'utf8', env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS } });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('postgres://u:p@host/db');
  });

  it('resolveEnvFile: 브라우저가 점을 떼고 내려받은 이름(env.prod.age)도 찾는다', () => {
    const d = mkdtempSync(join(tmpdir(), 'vault-flow2-'));
    writeFileSync(join(d, '.vault.json'), JSON.stringify({ branches: { main: 'prod' } }));
    writeFileSync(join(d, 'env.prod.age'), 'x');
    expect(resolveEnvFile({ cwd: d, branch: 'main' })).toEqual({ file: join(d, 'env.prod.age'), env: 'prod' });
    writeFileSync(join(d, 'env.age'), 'x');
    expect(resolveEnvFile({ cwd: d, branch: 'feature' })).toEqual({ file: join(d, 'env.age'), env: null });
  });
});

describe('vault-mcp: 검토에서 나온 결함', () => {
  const talk = (lines: string[], expectIds: number[]) =>
    new Promise<Record<number, { result?: { content?: { text: string }[] } }>>((resolve, reject) => {
      const child = spawn(process.execPath, [bin('vault-mcp.mjs')], { cwd: dir, env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS, VAULT_ENV_FILE: file } }); // 임시 폴더에서 띄운다: 사용 기록(.vault/)이 저장소에 생기지 않게
      const got: Record<number, never> = {};
      let buf = '';
      child.on('exit', (code) => code !== null && code !== 0 && reject(new Error(`server exited ${code}`)));
      child.stdout.on('data', (b: Buffer) => {
        buf += b.toString();
        for (const line of buf.split('\n').slice(0, -1)) {
          const m = JSON.parse(line) as { id: number };
          got[m.id] = m as never;
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
        if (expectIds.every((id) => id in got)) {
          child.kill();
          resolve(got);
        }
      });
      for (const l of lines) child.stdin.write(`${l}\n`);
    });

  it('`null`이나 숫자, 깨진 줄이 와도 죽지 않고 다음 요청에 답한다', async () => {
    const r = await talk(['null', '42', '[1,2]', 'not json', JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' })], [9]);
    expect(r[9]!.result).toEqual({});
  });

  it('긴 출력의 잘리는 자리에 값이 걸쳐도 앞부분이 새지 않는다 (가린 뒤에 자른다)', async () => {
    const code = `process.stdout.write('x'.repeat(${20_000 - 10}) + process.env.OPENAI_API_KEY)`;
    const r = await talk([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_with_keys', arguments: { command: process.execPath, args: ['-e', code], keys: ['OPENAI_API_KEY'] } } })], [1]);
    const out = r[1]!.result!.content![0]!.text;
    expect(out).not.toContain(SECRET.slice(0, 8));
    expect(out).toContain('[OPENAI'); // 가림 표시는 잘릴 수 있지만 값은 한 글자도 남지 않는다
  }, 30_000);
});

// @ts-expect-error 순수 JS 모듈이라 타입 선언이 없다
import { ghSecretArgs, isGithubSecretName } from '../src/flow.mjs';

describe('vault-push github', () => {
  it('이름 규칙과 인자: 값은 인자에 들어가지 않는다', () => {
    expect(isGithubSecretName('OPENAI_API_KEY')).toBe(true);
    expect(isGithubSecretName('GITHUB_TOKEN')).toBe(false);
    expect(isGithubSecretName('my.key')).toBe(false);
    expect(ghSecretArgs('A', { repo: 'me/app', env: 'production' })).toEqual(['secret', 'set', 'A', '--repo', 'me/app', '--env', 'production']);
    expect(ghSecretArgs('A')).toEqual(['secret', 'set', 'A']);
  });

  it('가짜 gh로: 이름마다 한 번씩 부르고, 값은 표준 입력으로만 넘긴다', () => {
    // gh 대신 받은 인자와 표준 입력을 파일에 적는 작은 프로그램을 끼운다
    const log = join(dir, 'gh.log');
    const fake = join(dir, 'fake-gh.mjs');
    writeFileSync(fake, `import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), stdin: readFileSync(0, 'utf8') }) + String.fromCharCode(10));\n`);
    const wrapper = join(dir, process.platform === 'win32' ? 'gh-fake.cmd' : 'gh-fake');
    writeFileSync(wrapper, process.platform === 'win32' ? `@"${process.execPath}" "${fake}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 });
    const run = (extra: string[]) => spawnSync(process.execPath, [bin('vault-push.mjs'), 'github', '--file', file, '--repo', 'me/app', ...extra], { encoding: 'utf8', env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS, VAULT_GH_BIN: wrapper } });

    const dry = run(['--dry-run']);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('OPENAI_API_KEY');
    expect(dry.stdout).not.toContain(SECRET);

    const r = run(['--only', 'OPENAI_API_KEY,DATABASE_URL']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(SECRET);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; stdin: string });
    expect(calls.map((c) => c.args)).toEqual([['secret', 'set', 'OPENAI_API_KEY', '--repo', 'me/app'], ['secret', 'set', 'DATABASE_URL', '--repo', 'me/app']]);
    expect(calls[0]!.stdin).toBe(SECRET);
    expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(SECRET);

    expect(run(['--only', 'NOPE']).status).toBe(2);
  });
});

// @ts-expect-error 순수 JS 모듈이라 타입 선언이 없다
import { parseVaultYml, readVaultConfig } from '../src/flow.mjs';

describe('.vault.yml: 폴더와 금고의 프로젝트를 잇는 설정', () => {
  it('parseVaultYml: project, ai, branches(따옴표 무늬), required. 주석과 모르는 줄은 무시', () => {
    const cfg = parseVaultYml('# 설명\nproject: shop\nai: false  # 끔\nbranches:\n  main: prod\n  "release/*": prod\n  "*": dev\nrequired:\n  - STRIPE_SECRET_KEY\n  - "DATABASE_URL"\nother: 1\n  - NOT_REQUIRED\n');
    expect(cfg).toEqual({ project: 'shop', ai: false, branches: { main: 'prod', 'release/*': 'prod', '*': 'dev' }, required: ['STRIPE_SECRET_KEY', 'DATABASE_URL'] });
    expect(parseVaultYml('project: a').ai).toBe(true); // 적지 않으면 켜짐
    expect(parseVaultYml('').required).toEqual([]);
  });

  it('readVaultConfig: .vault.yml 이 .vault.json 보다 먼저. resolveEnvFile도 yml의 브랜치 규칙을 쓴다', () => {
    const d = mkdtempSync(join(tmpdir(), 'vault-yml-'));
    writeFileSync(join(d, '.vault.json'), JSON.stringify({ branches: { main: 'dev' } }));
    writeFileSync(join(d, '.vault.yml'), 'project: shop\nbranches:\n  main: prod\n');
    writeFileSync(join(d, '.env.prod.age'), 'x');
    expect(readVaultConfig(d)).toMatchObject({ project: 'shop', source: '.vault.yml' });
    expect(resolveEnvFile({ cwd: d, branch: 'main' })).toEqual({ file: join(d, '.env.prod.age'), env: 'prod' });
  });

  it('vault-check: .env.example 이 없어도 required 의 빠진 이름을 찾는다', () => {
    const d = mkdtempSync(join(tmpdir(), 'vault-req-'));
    writeFileSync(join(d, '.vault.yml'), 'required:\n  - OPENAI_API_KEY\n  - NEW_ONE\n');
    const r = spawnSync(process.execPath, [bin('vault-check.mjs'), '--file', file], { cwd: d, env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NEW_ONE');
    expect(r.stderr).not.toContain('OPENAI_API_KEY');
  });
});

describe('keys-kept: npx 한 줄로 쓰는 단일 명령', () => {
  it('keys-kept run 은 vault-run 과 같다. 모르는 명령이면 2', () => {
    const r = spawnSync(process.execPath, [bin('keys-kept.mjs'), 'run', '--file', file, '--', process.execPath, '-e', 'console.log(process.env.DATABASE_URL)'], { env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('postgres://u:p@host/db');
    expect(spawnSync(process.execPath, [bin('keys-kept.mjs'), 'nope'], { encoding: 'utf8' }).status).toBe(2);
  });

  it('비밀번호 환경변수가 빈 문자열이면 없는 것으로 본다 (플러그인이 ${VAR:-}로 넘기는 경우)', () => {
    const r = spawnSync(process.execPath, [bin('vault-run.mjs'), '--file', file, '--', process.execPath, '-e', '1'], { env: { ...process.env, VAULT_ENV_PASSPHRASE: '' }, encoding: 'utf8', input: '' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('VAULT_ENV_PASSPHRASE'); // 빈 비밀번호로 풀려고 하지 않고, 물을 터미널이 없다고 알린다
  });
});

describe('vault-mcp: 폴더 설정을 따르고 쓴 기록을 남긴다', () => {
  const ask = (cwd: string, reqs: object[]) =>
    new Promise<Record<number, { result?: { content?: { text: string }[]; isError?: boolean } }>>((resolve) => {
      const child = spawn(process.execPath, [bin('vault-mcp.mjs')], { cwd, env: { ...process.env, VAULT_ENV_PASSPHRASE: PASS, VAULT_ENV_FILE: file, VAULT_PROJECT_DIR: '' } });
      const got: Record<number, never> = {};
      let buf = '';
      child.stdout.on('data', (b: Buffer) => {
        buf += b.toString();
        for (const line of buf.split('\n').slice(0, -1)) got[(JSON.parse(line) as { id: number }).id] = JSON.parse(line) as never;
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
        if (Object.keys(got).length === reqs.length) {
          child.kill();
          resolve(got);
        }
      });
      for (const r of reqs) child.stdin.write(`${JSON.stringify(r)}\n`);
    });
  const call = (id: number, name: string, args: object = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

  it('.vault.yml 에 ai: false 면 모든 도구가 거절하고, 아무것도 풀지 않는다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'vault-aioff-'));
    writeFileSync(join(d, '.vault.yml'), 'project: shop\nai: false\n');
    const r = await ask(d, [call(1, 'list_keys'), call(2, 'run_with_keys', { command: process.execPath, args: ['-e', '1'], keys: ['OPENAI_API_KEY'] })]);
    expect(r[1]!.result!.isError).toBe(true);
    expect(r[1]!.result!.content![0]!.text).toContain('ai: false');
    expect(r[2]!.result!.isError).toBe(true);
    expect(JSON.stringify(r)).not.toContain('OPENAI_API_KEY\nDATABASE_URL');
  });

  it('사용 기록: .vault/ai-log.jsonl 에 이름·명령·가린 횟수만 남고 값은 없다. .vault/.gitignore 도 만든다', async () => {
    const d = mkdtempSync(join(tmpdir(), 'vault-log-'));
    await ask(d, [call(1, 'list_keys'), call(2, 'run_with_keys', { command: process.execPath, args: ['-e', 'console.log(process.env.OPENAI_API_KEY)'], keys: ['OPENAI_API_KEY'] }), call(3, 'request_key', { name: 'RESEND_API_KEY' })]);
    const log = readFileSync(join(d, '.vault', 'ai-log.jsonl'), 'utf8');
    expect(log).not.toContain(SECRET);
    const rows = log.trim().split('\n').map((l) => JSON.parse(l) as { tool: string; keys?: string[]; redacted?: number; at: string });
    // 서버는 요청을 동시에 처리한다: 기록 순서는 끝난 순서라 이름으로 찾는다
    const by = (t: string) => rows.find((x) => x.tool === t);
    expect(rows.map((x) => x.tool).sort()).toEqual(['list_keys', 'request_key', 'run_with_keys']);
    expect(by('run_with_keys')).toMatchObject({ keys: ['OPENAI_API_KEY'], redacted: 1 });
    expect(by('request_key')).toMatchObject({ keys: ['RESEND_API_KEY'] });
    expect(Number.isNaN(Date.parse(rows[0]!.at))).toBe(false);
    expect(readFileSync(join(d, '.vault', '.gitignore'), 'utf8').trim()).toBe('*');
  }, 30_000);
});
