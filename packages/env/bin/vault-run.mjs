#!/usr/bin/env node
// vault-run [--file .env.age] -- <명령> [인자…]
// .env.age를 풀어 그 명령의 환경변수로만 넣고 실행한다. 평문은 디스크에 닿지 않는다.
import { spawn } from 'node:child_process';
import { readEnv, spawnPlan } from '../src/index.mjs';
import { resolveEnvFile } from '../src/flow.mjs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
// `--`가 없어도 맨 앞의 `--file X`는 옵션으로 읽는다 (없으면 `--file`을 명령으로 실행하려 든다)
const lead = sep < 0 && argv[0] === '--file' ? 2 : 0;
const opts = sep >= 0 ? argv.slice(0, sep) : argv.slice(0, lead);
const cmd = sep >= 0 ? argv.slice(sep + 1) : argv.slice(lead);
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
  entries = await readEnv(file);
} catch (e) {
  console.error(`vault-run: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const env = { ...process.env };
for (const k of ['VAULT_ENV_PASSPHRASE', 'VAULT_ENV_IDENTITY', 'VAULT_ENV_IDENTITY_FILE']) delete env[k]; // 실행하는 프로그램에는 금고를 여는 것을 넘기지 않는다
for (const { name, value } of entries) env[name] = value;

let plan;
try {
  plan = spawnPlan(cmd[0], cmd.slice(1));
} catch (e) {
  console.error(`vault-run: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
const child = spawn(plan.command, plan.args, { stdio: 'inherit', env, shell: plan.shell });
child.on('error', (e) => {
  console.error(`vault-run: ${cmd[0]} 실행 실패: ${e.message}`);
  process.exit(127);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
