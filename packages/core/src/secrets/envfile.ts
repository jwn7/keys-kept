/**
 * `.env` 읽기와 쓰기 (docs/STRATEGY.md 계획 1).
 * 붙여 넣은 .env를 항목으로 나누고, 항목을 다시 .env로 만든다. 흔히 쓰는 문법만 다룬다:
 * `NAME=value`, `export NAME=value`, 작은따옴표·큰따옴표(여러 줄 포함), `#` 주석, 큰따옴표 안의 `\n`.
 * 변수 끼워 넣기(`${OTHER}`)는 풀지 않고 글자 그대로 둔다: 남의 값을 조용히 합치지 않는다.
 *
 * `packages/env/src/index.mjs`에 같은 규칙을 옮겨 적은 구현이 있다. 여기를 고치면 거기도 고친다(테스트가 둘을 비교한다).
 */
export type EnvEntry = { name: string; value: string };

const NAME = '[A-Za-z_][A-Za-z0-9_.-]*';
const LINE_RE = new RegExp(`^\\s*(?:export\\s+)?(${NAME})\\s*=\\s*(.*)$`);
const NAME_RE = new RegExp(`^${NAME}$`);
const DQ_RE = /^"((?:[^"\\]|\\.)*)"/;
const SQ_RE = /^'([^']*)'/;

/** .env에 쓸 수 있는 이름인가. 아니면 내보낸 줄을 받는 쪽이 버린다. */
export function isEnvName(name: string): boolean {
  return NAME_RE.test(name);
}

export function parseEnv(text: string): EnvEntry[] {
  const out: EnvEntry[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (/^\s*(#|$)/.test(raw)) continue;
    const m = LINE_RE.exec(raw);
    if (!m) continue; // 알아볼 수 없는 줄은 건너뛴다
    const name = m[1]!;
    let rest = m[2]!.trim();
    let value: string;
    const quote = rest[0] === '"' ? DQ_RE : rest[0] === "'" ? SQ_RE : null;
    if (quote) {
      // 따옴표가 이 줄에서 안 닫혔으면 닫힐 때까지 다음 줄을 잇는다 (개인 키처럼 여러 줄인 값).
      // 끝까지 안 닫히면 잇지 않는다: 따옴표 하나 빠졌다고 뒤의 줄들을 전부 삼키면 안 된다.
      let joined = rest;
      let j = i;
      while (!quote.test(joined) && j + 1 < lines.length) joined += `\n${lines[++j]!}`;
      if (quote.test(joined)) {
        rest = joined;
        i = j;
      }
      const body = quote.exec(rest)?.[1] ?? rest.slice(1);
      value = quote === DQ_RE ? body.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c)) : body; // 작은따옴표 안은 글자 그대로
    } else {
      value = rest.replace(/\s+#.*$/, '').trim(); // 따옴표 없는 값 뒤의 ` # 주석`
    }
    out.push({ name, value });
  }
  return out;
}

/**
 * 따옴표가 필요 없는 값은 그대로. 필요하면 작은따옴표를 먼저 쓴다: 그 안은 글자 그대로라
 * 역슬래시를 두 번으로 읽는 도구가 없다. 값에 작은따옴표가 있을 때만 큰따옴표로 감싸고 이스케이프한다.
 */
export function formatEnv(entries: EnvEntry[]): string {
  return entries
    .map(({ name, value }) => {
      if (/^[^\s#"'\\]*$/.test(value)) return `${name}=${value}`;
      if (!value.includes("'")) return `${name}='${value}'`;
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      return `${name}="${escaped}"`;
    })
    .join('\n')
    .concat(entries.length ? '\n' : '');
}
