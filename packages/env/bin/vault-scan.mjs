#!/usr/bin/env node
// vault-scan [--file .env.age] [파일…]
// 커밋하려는 파일에 금고의 "실제 값"이 들어 있으면 이름과 위치를 알리고 1로 끝난다. 값은 찍지 않는다.
// 파일을 주지 않으면 git에 올린(staged) 파일을 본다. .git/hooks/pre-commit 에서 부르면 커밋을 막는다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readEnv } from '../src/index.mjs';
import { findLeaks, resolveEnvFile } from '../src/flow.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--file');
const { file } = resolveEnvFile({ file: at >= 0 ? argv[at + 1] : undefined });
const given = at < 0 ? argv : argv.filter((a, i) => i !== at && i !== at + 1);
// 파일을 직접 줬으면 그 파일을, 아니면 git에 올린(staged) 내용을 본다.
// 올린 내용은 작업 폴더의 파일이 아니라 `git show :경로`로 읽는다: 올린 뒤에 파일을 고쳤어도 커밋될 것을 본다.
// `-z`로 받아야 한글 같은 파일 이름이 따옴표와 숫자로 바뀌지 않는다. 경로는 저장소 맨 위 기준이다.
let staged = null;
if (given.length === 0) {
  try {
    staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACM'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch {
    console.error('scan: not a git repository. Pass the files to check.');
    process.exit(2);
  }
}
const files = staged ?? given;
const readTarget = (f) => (staged ? execFileSync('git', ['show', `:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) : readFileSync(f, 'utf8'));

let entries;
try {
  entries = await readEnv(file);
} catch (e) {
  console.error(`vault-scan: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

let found = 0;
for (const f of files) {
  let text;
  try {
    text = readTarget(f);
  } catch (e) {
    // 못 읽은 파일을 "깨끗함"으로 넘기지 않는다
    console.error(`scan: could not read ${f}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    process.exit(2);
  }
  for (const leak of findLeaks(text, entries)) {
    found++;
    console.error(`${f}:${leak.line}  ${leak.name}  (its value is on this line)`);
  }
}
if (found) {
  console.error(`\nscan: ${found} place(s) contain a value from the vault. Once committed, it stays in history. Remove the value and read it from an environment variable.`);
  process.exit(1);
}
