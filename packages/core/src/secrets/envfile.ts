/**
 * `.env` 읽기와 쓰기 (docs/STRATEGY.md 계획 1).
 * 붙여 넣은 .env를 항목으로 나누고, 항목을 다시 .env로 만든다. 흔히 쓰는 문법만 다룬다:
 * `NAME=value`, `export NAME=value`, 작은따옴표·큰따옴표, `#` 주석, 큰따옴표 안의 `\n`.
 * 변수 끼워 넣기(`${OTHER}`)는 풀지 않고 글자 그대로 둔다: 남의 값을 조용히 합치지 않는다.
 */
export type EnvEntry = { name: string; value: string };

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

export function parseEnv(text: string): EnvEntry[] {
  const out: EnvEntry[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const m = LINE_RE.exec(raw);
    if (!m) continue; // 알아볼 수 없는 줄은 건너뛴다
    const name = m[1]!;
    const rest = m[2]!.trim();
    let value: string;
    if (rest.startsWith('"')) {
      const body = /^"((?:[^"\\]|\\.)*)"/.exec(rest)?.[1] ?? rest.slice(1);
      value = body.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c));
    } else if (rest.startsWith("'")) {
      value = /^'([^']*)'/.exec(rest)?.[1] ?? rest.slice(1); // 작은따옴표 안은 글자 그대로
    } else {
      value = rest.replace(/\s+#.*$/, '').trim(); // 따옴표 없는 값 뒤의 ` # 주석`
    }
    out.push({ name, value });
  }
  return out;
}

/** 따옴표가 필요 없는 값은 그대로, 나머지는 큰따옴표로 감싸고 `\` `"` 줄바꿈을 이스케이프한다. */
export function formatEnv(entries: EnvEntry[]): string {
  return entries
    .map(({ name, value }) => {
      if (/^[^\s#"'\\]*$/.test(value)) return `${name}=${value}`;
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      return `${name}="${escaped}"`;
    })
    .join('\n')
    .concat(entries.length ? '\n' : '');
}
