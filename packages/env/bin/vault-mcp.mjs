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
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readEnv, redact, spawnPlan } from '../src/index.mjs';

const FILE = process.env.VAULT_ENV_FILE ?? '.env.age';
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 20_000;

const TOOLS = [
  { name: 'list_keys', description: '금고(.env.age)에 있는 키의 이름 목록. 값은 돌려주지 않는다.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'run_with_keys',
    description: '고른 키의 값을 환경변수로 넣어 명령을 실행한다. 값은 이 대화에 나타나지 않으며, 출력에 값이 찍히면 가려진다. 키 값을 직접 물어보거나 파일에 쓰지 말고 이 도구를 쓴다.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '실행할 프로그램 (예: npm)' },
        args: { type: 'array', items: { type: 'string' }, description: '인자 (예: ["run", "dev"])' },
        keys: { type: 'array', items: { type: 'string' }, description: '넣을 키 이름들. list_keys의 이름 그대로' },
        cwd: { type: 'string', description: '실행할 폴더 (기본: 현재 폴더)' },
      },
      required: ['command', 'keys'],
    },
  },
  { name: 'request_key', description: '필요한 키가 금고에 없을 때, 사용자에게 무엇을 넣어 달라고 할지 안내문을 만든다. 값을 채팅에 붙여 넣게 하지 않는다.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name'] } },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

async function entries() {
  // stdio는 프로토콜이 쓰므로 비밀번호를 물을 수 없다. 환경변수로 받은 것만 쓴다.
  if (!process.env.VAULT_ENV_PASSPHRASE && !process.env.VAULT_ENV_IDENTITY && !process.env.VAULT_ENV_IDENTITY_FILE) throw new Error('VAULT_ENV_PASSPHRASE 또는 VAULT_ENV_IDENTITY_FILE이 설정되지 않았습니다.');
  return readEnv(FILE);
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
      resolve({ code: 127, out: `실행 실패: ${e.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
  });
}

async function callTool(name, a = {}) {
  if (name === 'list_keys') {
    const all = await entries();
    return text(all.length ? all.map((e) => e.name).join('\n') : '(키 없음)');
  }
  if (name === 'request_key') {
    return text(`금고에 ${a.name} 이(가) 없습니다.${a.why ? ` (${a.why})` : ''}\n사용자에게 이렇게 안내하세요: Vault 앱에서 ${a.name} 을(를) 추가한 뒤 이 프로젝트를 "암호화해서 내려받기"로 다시 내보내 ${FILE} 을(를) 바꿔 주세요. 값을 채팅에 붙여 넣지 마세요.`);
  }
  if (name === 'run_with_keys') {
    if (typeof a.command !== 'string' || !Array.isArray(a.keys)) return text('command(문자열)와 keys(배열)가 필요합니다.', true);
    const all = await entries();
    const missing = a.keys.filter((k) => !all.some((e) => e.name === k));
    if (missing.length) return text(`금고에 없는 키: ${missing.join(', ')}. list_keys로 이름을 확인하거나 request_key로 사용자에게 요청하세요.`, true);
    const env = { ...process.env };
    for (const k of ['VAULT_ENV_PASSPHRASE', 'VAULT_ENV_IDENTITY', 'VAULT_ENV_IDENTITY_FILE']) delete env[k]; // 실행하는 프로그램에는 금고를 여는 것을 넘기지 않는다
    for (const e of all) if (a.keys.includes(e.name)) env[e.name] = e.value;
    const r = await runCommand(a.command, Array.isArray(a.args) ? a.args.map(String) : [], env, typeof a.cwd === 'string' ? a.cwd : undefined);
    // 고르지 않은 키의 값이 찍혀도 가린다
    const safe = redact(r.out, all); // 먼저 가리고, 그다음 자른다
    return text(`종료 코드 ${r.code}\n${safe.length > MAX_OUTPUT ? `${safe.slice(0, MAX_OUTPUT)}\n… (잘림)` : safe}`, r.code !== 0);
  }
  return text(`모르는 도구: ${name}`, true);
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
      reply({ protocolVersion: req.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vault-env', version: '0.0.1' } });
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
