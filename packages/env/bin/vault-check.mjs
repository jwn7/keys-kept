#!/usr/bin/env node
// vault-check [--file .env.age] [--example .env.example]
// .vault.yml의 required와 저장소의 .env.example이 요구하는 이름이 금고에 다 있는지 본다. 빠진 것이 있으면 이름을 알리고 1로 끝난다.
// 실행하거나 배포하기 전에 돌리면 "변수 하나 빠져서 죽는" 일을 미리 잡는다.
import { existsSync, readFileSync } from 'node:fs';
import { readEnv } from '../src/index.mjs';
import { missingNames, readVaultConfig, resolveEnvFile } from '../src/flow.mjs';

const argv = process.argv.slice(2);
const opt = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : undefined);
const example = opt('--example') ?? '.env.example';
const { file, env } = resolveEnvFile({ file: opt('--file') });

const required = readVaultConfig()?.required ?? [];
if (!existsSync(example) && required.length === 0) {
  console.error(`check: found neither ${example} nor \`required\` in .vault.yml. List the variable names your code needs in one of them.`);
  process.exit(2);
}
let entries;
try {
  entries = await readEnv(file);
} catch (e) {
  console.error(`check: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
const wanted = [...required.map((n) => `${n}=`), ...(existsSync(example) ? [readFileSync(example, 'utf8')] : [])].join('\n');
const missing = [...new Set(missingNames(wanted, entries))];
if (missing.length) {
  console.error(`check: ${missing.length} name(s) missing from ${file}${env ? ` (${env})` : ''}\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log('check: every required name is present.');
