#!/usr/bin/env node
// vault-check [--file .env.age] [--example .env.example]
// 저장소의 .env.example이 요구하는 이름이 금고에 다 있는지 본다. 빠진 것이 있으면 이름을 알리고 1로 끝난다.
// 실행하거나 배포하기 전에 돌리면 "변수 하나 빠져서 죽는" 일을 미리 잡는다.
import { existsSync, readFileSync } from 'node:fs';
import { getPassphrase, readEnvAge } from '../src/index.mjs';
import { missingNames, resolveEnvFile } from '../src/flow.mjs';

const argv = process.argv.slice(2);
const opt = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : undefined);
const example = opt('--example') ?? '.env.example';
const { file, env } = resolveEnvFile({ file: opt('--file') });

if (!existsSync(example)) {
  console.error(`vault-check: ${example} 이 없습니다. 코드가 쓰는 변수 이름을 값 없이 적어 둔 파일입니다.`);
  process.exit(2);
}
let entries;
try {
  entries = await readEnvAge(file, await getPassphrase(file));
} catch (e) {
  console.error(`vault-check: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
const missing = missingNames(readFileSync(example, 'utf8'), entries);
if (missing.length) {
  console.error(`vault-check: ${file}${env ? ` (${env})` : ''} 에 없는 이름 ${missing.length}개\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`vault-check: ${example} 의 이름이 모두 있습니다.`);
