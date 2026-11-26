# keys-kept

Run commands with keys from an encrypted `.env.age`, without a plaintext `.env` on disk. Includes an MCP server so AI coding tools (Claude Code, Cursor) use your keys **by name** and never receive the values.

The encrypted files come from the Keys Kept app ([jwn7/keys-kept](https://github.com/jwn7/keys-kept)), and they are standard [age](https://age-encryption.org) files, so `age -d .env.age` also works.

```sh
npx keys-kept run -- npm run dev          # decrypt into this command's environment only
npx keys-kept check                       # every name in .vault.yml `required` / .env.example present?
npx keys-kept scan                        # staged files contain a real key value? (pre-commit)
npx keys-kept push github --repo me/app   # copy keys into GitHub Actions secrets via your gh login
npx keys-kept mcp                         # MCP server (stdio): list_keys, run_with_keys, request_key
```

Claude Code: `/plugin marketplace add jwn7/keys-kept` then `/plugin install keys-kept@keys-kept`, or
`claude mcp add --transport stdio --env VAULT_ENV_PASSPHRASE=<file password> keys-kept -- npx -y keys-kept mcp`.

A `.vault.yml` in the project folder links it to a vault project and picks the file per git branch:

```yaml
project: shop
ai: true            # false: the MCP tools refuse for this folder
branches:
  main: prod        # main uses .env.prod.age
  "*": dev          # other branches use .env.dev.age
required:
  - STRIPE_SECRET_KEY
```

The MCP server logs which key **names** it used (never values) to `.vault/ai-log.jsonl`, which the app shows. Set `VAULT_AI_LOG=0` to turn that off.

Not externally audited. Read the limits below before using it with production keys.

---

## 한국어


Vault 앱에서 프로젝트를 **암호화해서 내려받기** 하면 `.env.age` 파일이 생긴다. 표준 age 파일이고 안에는 보통의 `.env` 글이 들어 있다. 이 패키지는 그 파일을 풀어 **실행하는 프로그램의 환경변수로만** 넣는다. 풀린 값은 디스크에 닿지 않는다.

> 외부 보안 검토를 받지 않았다. 운영 키에 쓰기 전에 `docs/SECURITY.md`의 한계를 읽을 것.

## 1. 감싸서 실행
```
npx keys-kept run -- npm run dev
npx keys-kept run --file .env.prod.age -- node server.js
```
비밀번호를 한 번 묻는다(글자는 보이지 않는다). 물을 터미널이 없으면 `VAULT_ENV_PASSPHRASE` 환경변수에서 읽는다. 실행하는 프로그램에는 금고 비밀번호를 넘기지 않는다.

## 2. 코드에서 한 줄로
```js
import 'keys-kept/load'; // dotenv의 'dotenv/config' 자리
```
`.env.age`가 있으면 풀어 `process.env`에 넣는다. 이미 있는 이름은 덮어쓰지 않는다. 파일이 없으면 조용히 넘어간다(배포 환경에서는 환경변수가 직접 들어온다).

## 3. AI 코딩 도구에 연결 (MCP)
AI가 "이 키를 넣어 주세요"라고 할 때 채팅에 붙여 넣지 않게 한다. AI는 키를 **이름으로만** 쓰고 값은 받지 못한다.

```json
{
  "mcpServers": {
    "vault": {
      "command": "npx",
      "args": ["-y", "keys-kept", "mcp"],
      "env": { "VAULT_ENV_PASSPHRASE": "<파일 비밀번호>" }
    }
  }
}
```

| 도구 | 하는 일 |
|---|---|
| `list_keys` | 키 이름 목록. 값은 없다 |
| `run_with_keys` | 고른 이름의 값을 환경변수로 넣어 명령을 실행하고, 출력에 값이 찍혀 있으면 `[이름 hidden]`으로 바꿔 돌려준다 |
| `request_key` | 없는 키를 사용자에게 요청하는 안내문 |

값을 돌려주는 도구는 일부러 만들지 않았다.

### 한계
- 실행한 명령이 값을 다른 곳으로 보내는 것은 막지 못한다. 명령을 실행해도 되는지는 AI 도구의 권한 창이 묻는다.
- MCP 설정 파일에 파일 비밀번호가 평문으로 들어간다. OS 키체인 연동은 아직 없다. 이 비밀번호는 마스터 비밀번호와 다른 것으로 정할 것.
- 가리기는 값과 똑같은 글자열만 잡는다. 프로그램이 값을 잘라서 찍거나 다른 꼴(base64 등)로 바꿔 찍으면 못 잡는다.
- 6자보다 짧은 값은 가리지 않는다(우연히 겹치는 글자가 많다).

## 4. 깃 브랜치에 따라 환경 고르기
프로젝트 폴더에 `.vault.yml`(위 예시)을 두면 `run`과 `mcp`가 지금 브랜치에 맞는 파일을 고른다. 예전 `.vault.json`(`{ "branches": {...} }`)도 계속 읽는다. `required`는 `check`가, `ai: false`는 `mcp`가 본다.
`main`에서는 `.env.prod.age`, 그 밖의 브랜치에서는 `.env.dev.age`를 쓴다. 맞는 파일이 없으면 `.env.age`. `--file`을 주면 그것이 우선한다.

## 5. 실행 전에 빠진 변수 찾기
```
npx keys-kept check            # .env.example 의 이름이 금고에 다 있는지
```
빠진 이름이 있으면 알리고 종료 코드 1로 끝난다.

## 6. 커밋 전에 유출 막기
```
npx keys-kept scan             # git에 올린 파일에 금고의 값이 들어 있는지
npx keys-kept scan src/a.ts    # 파일을 직접 줄 수도 있다
```
모양으로 추측하는 검사기와 달리 금고의 **실제 값**과 비교하므로, 어떤 서비스의 키든 잡는다. 값은 다시 찍지 않고 파일·줄·키 이름만 알린다. 8자 미만의 값은 보지 않는다.
`.git/hooks/pre-commit`에서 부르면 커밋을 막는다(비밀번호는 `VAULT_ENV_PASSPHRASE`).

## 7. GitHub Actions 비밀값으로 올리기
```
npx keys-kept push github --dry-run                 # 무엇이 올라갈지만 본다
npx keys-kept push github --repo me/app             # 전부
npx keys-kept push github --only OPENAI_API_KEY --env production
```
우리 서버를 거치지 않는다. 이 기기에서 [GitHub CLI](https://cli.github.com/)(`gh`)의 로그인으로 바로 올리므로 `gh auth login`이 돼 있어야 한다. 값은 명령줄 인자가 아니라 표준 입력으로 넘긴다. GitHub는 올린 값을 다시 보여주지 않으므로, 원본은 계속 금고에 둔다.

## 8. 팀원이 보낸 파일 열기
팀원이 내 공개키로 잠가 보낸 파일은 비밀번호 대신 내 개인키로 연다(`docs/TEAM.md`).
```
VAULT_ENV_IDENTITY_FILE=내개인키.txt  npx keys-kept run --file .env.age -- npm run dev
```

## age만으로 풀기
이 패키지가 없어도 된다.
```
age -d .env.age
```
