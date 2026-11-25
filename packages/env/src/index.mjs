// @vault/env: 암호화된 .env.age를 Node에서 풀어 쓴다. 빌드 없이 도는 순수 JS(ESM)이고 의존성은 age-encryption 하나다.
// 파일 형식: 표준 age 패스프레이즈 파일 안에 보통의 .env 글. 앱의 "암호화해서 내려받기"가 만든다 (packages/core/src/secrets/envage.ts).
import { readFile } from 'node:fs/promises';
import { Decrypter } from 'age-encryption';

/**
 * .env 글 → [{ name, value }]. packages/core/src/secrets/envfile.ts의 parseEnv와 같은 규칙이다
 * (core는 TypeScript 소스라 Node가 바로 못 읽어서 옮겨 적었다. 두 구현이 같은 결과를 내는지는 테스트가 지킨다).
 */
export function parseEnv(text) {
  const out = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    const rest = m[2].trim();
    let value;
    if (rest.startsWith('"')) {
      const body = /^"((?:[^"\\]|\\.)*)"/.exec(rest)?.[1] ?? rest.slice(1);
      value = body.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c));
    } else if (rest.startsWith("'")) {
      value = /^'([^']*)'/.exec(rest)?.[1] ?? rest.slice(1);
    } else {
      value = rest.replace(/\s+#.*$/, '').trim();
    }
    out.push({ name: m[1], value });
  }
  return out;
}

/** age 바이트 + 패스프레이즈 → [{ name, value }]. 틀리면 던진다. */
export async function openEnvAge(bytes, passphrase) {
  const d = new Decrypter();
  d.addPassphrase(passphrase);
  let text;
  try {
    text = await d.decrypt(bytes, 'text');
  } catch {
    throw new Error('비밀번호가 틀렸거나 age 파일이 아닙니다.');
  }
  return parseEnv(text);
}

export async function readEnvAge(file, passphrase) {
  return openEnvAge(new Uint8Array(await readFile(file)), passphrase);
}

/**
 * 글 속에 값이 그대로 찍혀 있으면 가린다. AI에게 실행 결과를 돌려주기 전에 쓴다.
 * 짧은 값(6자 미만)은 우연히 겹치는 글자가 많아 가리지 않는다. 긴 값부터 바꿔서 한 값이 다른 값의 일부일 때도 통째로 가린다.
 */
export function redact(text, entries) {
  let out = text;
  for (const { name, value } of [...entries].sort((a, b) => b.value.length - a.value.length)) {
    if (value.length >= 6) out = out.split(value).join(`[${name} 가림]`);
  }
  return out;
}

/**
 * Windows에서 npm·pnpm 같은 명령은 .cmd라 셸을 거쳐야 실행된다. 실행 파일(.exe)을 직접 가리킬 때는 셸을 쓰지 않는다:
 * 셸을 거치면 공백이나 따옴표가 든 인자가 깨진다.
 */
export function needsShell(command) {
  return process.platform === 'win32' && !/\.(exe|com)$/i.test(command);
}

/** 터미널에서 글자를 보이지 않게 비밀번호를 받는다. 터미널이 아니면(파이프 등) 던진다. */
export function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    if (!stdin.isTTY) return reject(new Error('비밀번호를 물을 터미널이 없습니다. VAULT_ENV_PASSPHRASE 환경변수로 넘기세요.'));
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const done = (fn) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(buf));
        if (ch === '\u0003') return done(() => reject(new Error('취소했습니다.'))); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** 비밀번호: VAULT_ENV_PASSPHRASE가 있으면 그것, 없으면 터미널에서 묻는다. */
export async function getPassphrase(file) {
  return process.env.VAULT_ENV_PASSPHRASE ?? promptHidden(`${file} 비밀번호: `);
}

/** 풀어서 process.env에 넣는다. 이미 있는 이름은 덮어쓰지 않는다(배포 환경이 정한 값이 우선). 넣은 이름 목록을 돌려준다. */
export async function loadEnvAge({ file = process.env.VAULT_ENV_FILE ?? '.env.age', passphrase } = {}) {
  const entries = await readEnvAge(file, passphrase ?? (await getPassphrase(file)));
  const set = [];
  for (const { name, value } of entries) {
    if (process.env[name] === undefined) {
      process.env[name] = value;
      set.push(name);
    }
  }
  return set;
}
