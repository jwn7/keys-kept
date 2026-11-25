#!/usr/bin/env node
// vault-push github [--file .env.age] [--repo owner/name] [--env 환경이름] [--only A,B] [--dry-run]
// 금고의 값을 GitHub Actions 비밀값으로 올린다. 우리 서버를 거치지 않는다: 이 기기에서 사용자의 `gh` 로그인으로 바로 올린다.
// 값은 명령줄 인자가 아니라 표준 입력으로 넘긴다(다른 프로그램이 실행 목록에서 볼 수 없게).
import { spawnSync } from 'node:child_process';
import { readEnv, spawnPlan } from '../src/index.mjs';
import { resolveEnvFile } from '../src/flow.mjs';
import { ghSecretArgs, isGithubSecretName } from '../src/flow.mjs';

const argv = process.argv.slice(2);
const opt = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : undefined);
const target = argv[0];
if (target !== 'github') {
  console.error('사용법: vault-push github [--file .env.age] [--repo owner/name] [--env 환경이름] [--only A,B] [--dry-run]');
  process.exit(2);
}
const dry = argv.includes('--dry-run');
const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const { file } = resolveEnvFile({ file: opt('--file') });
const gh = process.env.VAULT_GH_BIN ?? 'gh'; // 테스트에서 가짜 gh를 끼울 수 있게

let entries;
try {
  entries = await readEnv(file);
} catch (e) {
  console.error(`vault-push: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
if (only) {
  const missing = only.filter((n) => !entries.some((e) => e.name === n));
  if (missing.length) {
    console.error(`vault-push: 금고에 없는 이름: ${missing.join(', ')}`);
    process.exit(2);
  }
  entries = entries.filter((e) => only.includes(e.name));
}

let failed = 0;
for (const { name, value } of entries) {
  if (!isGithubSecretName(name)) {
    console.error(`건너뜀  ${name}  (GitHub 비밀값 이름으로 쓸 수 없습니다: 영문·숫자·밑줄만, GITHUB_ 로 시작 불가)`);
    continue;
  }
  if (dry) {
    console.log(`올릴 것  ${name}`);
    continue;
  }
  const plan = spawnPlan(gh, ghSecretArgs(name, { repo: opt('--repo'), env: opt('--env') }));
  const r = spawnSync(plan.command, plan.args, { input: value, shell: plan.shell, encoding: 'utf8' });
  if (r.status === 0) console.log(`올림    ${name}`);
  else {
    failed++;
    console.error(`실패    ${name}  ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`);
  }
}
if (failed) {
  console.error(`\nvault-push: ${failed}개를 올리지 못했습니다. \`gh auth status\`로 로그인과 저장소 권한을 확인하세요.`);
  process.exit(1);
}
