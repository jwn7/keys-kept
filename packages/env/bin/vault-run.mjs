#!/usr/bin/env node
// vault-run [--file .env.age] -- <명령> [인자…]
// .env.age를 풀어 그 명령의 환경변수로만 넣고 실행한다. 평문은 디스크에 닿지 않는다.
import { spawn } from 'node:child_process';
import { getPassphrase, needsShell, readEnvAge } from '../src/index.mjs';
import { resolveEnvFile } from '../src/flow.mjs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep >= 0 ? argv.slice(0, sep) : [];
const cmd = sep >= 0 ? argv.slice(sep + 1) : argv;
const fileAt = opts.indexOf('--file');
// 파일을 안 주면: .vault.json의 브랜치 → 환경 규칙으로 .env.<환경>.age 를 고르고, 없으면 .env.age
const { file, env: branchEnv } = resolveEnvFile({ file: fileAt >= 0 ? opts[fileAt + 1] : undefined });
if (branchEnv) console.error(`vault-run: 지금 브랜치의 환경은 ${branchEnv}`);

if (cmd.length === 0 || !file) {
  console.error('사용법: vault-run [--file .env.age] -- <명령> [인자…]\n예:     vault-run -- npm run dev');
  process.exit(2);
}

let entries;
try {
  entries = await readEnvAge(file, await getPassphrase(file));
} catch (e) {
  console.error(`vault-run: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const env = { ...process.env };
delete env.VAULT_ENV_PASSPHRASE; // 실행하는 프로그램에는 금고 비밀번호를 넘기지 않는다
for (const { name, value } of entries) env[name] = value;

const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env, shell: needsShell(cmd[0]) });
child.on('error', (e) => {
  console.error(`vault-run: ${cmd[0]} 실행 실패: ${e.message}`);
  process.exit(127);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
