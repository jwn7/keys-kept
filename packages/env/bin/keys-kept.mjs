#!/usr/bin/env node
// keys-kept <명령> ...   — npx 한 줄로 쓰려고 명령을 하나로 묶었다. 각 명령은 같은 이름의 vault-* 와 똑같다.
//   keys-kept run [--file F] -- <명령>     풀어서 그 명령의 환경변수로만 넣는다
//   keys-kept mcp                          AI 코딩 도구용 MCP 서버 (stdio)
//   keys-kept check                        필요한 이름이 금고에 다 있는지
//   keys-kept scan [파일...]               커밋할 파일에 금고의 값이 들었는지
//   keys-kept push github [...]            GitHub Actions 비밀값으로 올리기
const COMMANDS = { run: 'vault-run.mjs', mcp: 'vault-mcp.mjs', check: 'vault-check.mjs', scan: 'vault-scan.mjs', push: 'vault-push.mjs' };
const [cmd] = process.argv.splice(2, 1);
if (!cmd || !COMMANDS[cmd]) {
  console.error(`keys-kept: choose a command: ${Object.keys(COMMANDS).join(' | ')}\n  e.g. npx keys-kept run -- npm run dev\n       npx keys-kept mcp   (Claude Code: claude mcp add --transport stdio --env VAULT_ENV_PASSPHRASE=... keys-kept -- npx -y keys-kept mcp)`);
  process.exit(cmd ? 2 : 0);
}
await import(new URL(`./${COMMANDS[cmd]}`, import.meta.url).href);
