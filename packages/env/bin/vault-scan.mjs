#!/usr/bin/env node
// vault-scan [--file .env.age] [파일…]
// 커밋하려는 파일에 금고의 "실제 값"이 들어 있으면 이름과 위치를 알리고 1로 끝난다. 값은 찍지 않는다.
// 파일을 주지 않으면 git에 올린(staged) 파일을 본다. .git/hooks/pre-commit 에서 부르면 커밋을 막는다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getPassphrase, readEnvAge } from '../src/index.mjs';
import { findLeaks, resolveEnvFile } from '../src/flow.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--file');
const { file } = resolveEnvFile({ file: at >= 0 ? argv[at + 1] : undefined });
let files = argv.filter((a, i) => a !== '--file' && i !== at + 1);
if (at < 0) files = argv;
if (files.length === 0) {
  try {
    files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    console.error('vault-scan: git 저장소가 아닙니다. 검사할 파일을 직접 주세요.');
    process.exit(2);
  }
}

let entries;
try {
  entries = await readEnvAge(file, await getPassphrase(file));
} catch (e) {
  console.error(`vault-scan: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

let found = 0;
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue; // 지워졌거나 읽을 수 없는 파일
  }
  for (const leak of findLeaks(text, entries)) {
    found++;
    console.error(`${f}:${leak.line}  ${leak.name} 의 값이 들어 있습니다`);
  }
}
if (found) {
  console.error(`\nvault-scan: 금고의 값 ${found}곳. 커밋하면 저장소에 남습니다. 값을 빼고 환경변수로 읽도록 고치세요.`);
  process.exit(1);
}
