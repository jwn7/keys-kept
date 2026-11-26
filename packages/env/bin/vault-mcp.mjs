#!/usr/bin/env node
// AI 코딩 도구용 MCP 서버 (stdio). AI가 키를 "이름으로만" 쓰게 한다. 값은 AI에게 가지 않는다.
//
// 도구:
//   list_keys      .env.age에 있는 키 이름 목록 (값 없음)
//   run_with_keys  고른 이름의 값을 환경변수로 넣어 명령을 실행하고, 결과에 값이 찍혀 있으면 가려서 돌려준다
//   request_key    없는 키를 사용자에게 요청하는 안내문을 돌려준다
// 값을 돌려주는 도구는 없다. 일부러 만들지 않았다.
//
// 한계 (docs/SECURITY.md): 실행한 명령이 값을 다른 곳으로 보내는 것은 막지 못한다. 명령 실행 승인은 AI 도구의 권한 창이 맡는다.
// 비밀번호는 VAULT_ENV_PASSPHRASE 환경변수로 받는다(stdio는 프로토콜이 쓰므로 물을 수 없다).
// 어느 파일을 여는지: VAULT_ENV_FILE → 폴더의 .vault.yml 브랜치 규칙 → .env.age (vault-run과 같다).
// .vault.yml에 `ai: false`면 모든 도구가 거절한다. 쓴 기록(이름·명령·시각, 값은 없음)은 .vault/ai-log.jsonl에 남긴다(VAULT_AI_LOG=0이면 끈다).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { readEnv, redact, spawnPlan } from '../src/index.mjs';
import { readVaultConfig, resolveEnvFile } from '../src/flow.mjs';

/** 프로젝트 폴더: AI 도구가 띄운 곳(보통 저장소 뿌리). VAULT_PROJECT_DIR로 바꿀 수 있다. */
const ROOT = process.env.VAULT_PROJECT_DIR || process.cwd(); // 빈 값은 없는 것으로 (플러그인이 ${VAR:-}로 넘긴다)
/** 부를 때마다 다시 본다: 브랜치를 바꾸거나 앱이 키 파일을 다시 써도 서버를 다시 띄울 필요가 없게. */
const where = () => ({ cfg: readVaultConfig(ROOT), ...resolveEnvFile({ cwd: ROOT }) });

/** 사용 기록. 값은 절대 넣지 않는다. 앱의 연결 탭이 이 파일을 읽어 보여 준다. 실패해도 도구는 계속 동작한다. */
function logUse(rec) {
  if (process.env.VAULT_AI_LOG === '0') return;
  try {
    const dir = join(ROOT, '.vault');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '*\n'); // 기록은 저장소에 올리지 않는다
    appendFileSync(join(dir, 'ai-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...rec })}\n`);
  } catch {
    /* 읽기 전용 폴더 등 */
  }
}
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 20_000;

const TOOLS = [
  { name: 'list_keys', description: 'List the names of the keys available in this project (for the current git branch environment). Never returns values.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'run_with_keys',
    description: 'Run a command with the chosen keys injected as environment variables. Values never appear in this conversation; any value printed in the output is replaced with [NAME hidden]. Use this instead of asking the user for a key or writing it to a file.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Program to run (e.g. npm)' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments (e.g. ["run", "dev"])' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Key names to inject, exactly as list_keys returns them' },
        cwd: { type: 'string', description: 'Working directory (default: the project folder)' },
      },
      required: ['command', 'keys'],
    },
  },
  { name: 'request_key', description: 'When a needed key is missing, returns the message to show the user: add it in the Keys Kept app. Never ask the user to paste a value into the chat.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name'] } },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

async function entries(file) {
  // stdio는 프로토콜이 쓰므로 비밀번호를 물을 수 없다. 환경변수로 받은 것만 쓴다.
  if (!process.env.VAULT_ENV_PASSPHRASE && !process.env.VAULT_ENV_IDENTITY && !process.env.VAULT_ENV_IDENTITY_FILE) throw new Error('Neither VAULT_ENV_PASSPHRASE nor VAULT_ENV_IDENTITY_FILE is set. Ask the user to set one in the shell that starts the AI tool, then restart it. Do not ask for the passphrase in chat.');
  return readEnv(file);
}

function runCommand(command, args, env, cwd) {
  return new Promise((resolve) => {
    let out = '';
    let plan;
    try {
      plan = spawnPlan(command, args);
    } catch (e) {
      return resolve({ code: 2, out: e instanceof Error ? e.message : String(e) });
    }
    const child = spawn(plan.command, plan.args, { env, cwd, shell: plan.shell });
    // 자르기는 가린 뒤에 한다(아래 callTool). 여기서 자르면 잘린 자리에 걸친 값이 가려지지 않고 앞부분이 새어 나간다.
    // 메모리만 지키려고 넉넉한 한도를 둔다.
    const add = (b) => {
      if (out.length < MAX_OUTPUT * 50) out += b.toString();
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 127, out: `failed to start: ${e.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
  });
}

async function callTool(name, a = {}) {
  const w = where();
  if (w.cfg && w.cfg.ai === false) {
    return text('AI tool access is turned off for this project (ai: false in .vault.yml). The user can turn it on in the Keys Kept app (project > Connect). Do not ask for values in chat.', true);
  }
  const place = `${w.cfg?.project ?? 'this project'}${w.env ? ` > ${w.env}` : ''}`;
  if (name === 'list_keys') {
    const all = await entries(w.file);
    logUse({ tool: 'list_keys', env: w.env, count: all.length });
    return text(all.length ? all.map((e) => e.name).join('\n') : '(no keys)');
  }
  if (name === 'request_key') {
    logUse({ tool: 'request_key', keys: [String(a.name)], env: w.env });
    return text(`${a.name} is not in the vault.${a.why ? ` (${a.why})` : ''}\nTell the user: add ${a.name} to ${place} in the Keys Kept app. If the app is connected to this folder, the key file is rewritten right away; otherwise export it with "Download encrypted" and replace ${w.file}. Do not paste the value into the chat.`);
  }
  if (name === 'run_with_keys') {
    if (typeof a.command !== 'string' || !Array.isArray(a.keys)) return text('command (string) and keys (array) are required.', true);
    const all = await entries(w.file);
    const missing = a.keys.filter((k) => !all.some((e) => e.name === k));
    if (missing.length) return text(`Not in the vault: ${missing.join(', ')}. Check names with list_keys, or ask the user with request_key.`, true);
    const env = { ...process.env };
    for (const k of ['VAULT_ENV_PASSPHRASE', 'VAULT_ENV_IDENTITY', 'VAULT_ENV_IDENTITY_FILE']) delete env[k]; // 실행하는 프로그램에는 금고를 여는 것을 넘기지 않는다
    for (const e of all) if (a.keys.includes(e.name)) env[e.name] = e.value;
    const r = await runCommand(a.command, Array.isArray(a.args) ? a.args.map(String) : [], env, typeof a.cwd === 'string' ? a.cwd : undefined);
    // 고르지 않은 키의 값이 찍혀도 가린다
    const safe = redact(r.out, all); // 먼저 가리고, 그다음 자른다
    const args = Array.isArray(a.args) ? a.args.map(String) : [];
    logUse({ tool: 'run_with_keys', command: redact([a.command, ...args].join(' '), all).slice(0, 200), keys: a.keys.map(String), redacted: all.filter((e) => e.value.length >= 6 && r.out.includes(e.value)).length, env: w.env, code: r.code });
    return text(`exit code ${r.code}\n${safe.length > MAX_OUTPUT ? `${safe.slice(0, MAX_OUTPUT)}\n… (truncated)` : safe}`, r.code !== 0);
  }
  return text(`unknown tool: ${name}`, true);
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

createInterface({ input: process.stdin }).on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  // `null`, 숫자, 배열 같은 줄에 죽지 않는다. 요청은 객체여야 한다.
  if (req === null || typeof req !== 'object' || Array.isArray(req)) return;
  if (req.id === undefined) return; // 알림(notifications/initialized 등)에는 답하지 않는다
  const reply = (result) => send({ jsonrpc: '2.0', id: req.id, result });
  try {
    if (req.method === 'initialize') {
      reply({ protocolVersion: req.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'keys-kept', version: '0.1.1' } });
    } else if (req.method === 'ping') {
      reply({});
    } else if (req.method === 'tools/list') {
      reply({ tools: TOOLS });
    } else if (req.method === 'tools/call') {
      reply(await callTool(req.params?.name, req.params?.arguments));
    } else {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
    }
  } catch (e) {
    reply(text(e instanceof Error ? e.message : String(e), true));
  }
});
