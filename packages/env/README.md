# @vault/env: 평문 `.env` 없이 키 꺼내 쓰기

Vault 앱에서 프로젝트를 **암호화해서 내려받기** 하면 `.env.age` 파일이 생긴다. 표준 age 파일이고 안에는 보통의 `.env` 글이 들어 있다. 이 패키지는 그 파일을 풀어 **실행하는 프로그램의 환경변수로만** 넣는다. 풀린 값은 디스크에 닿지 않는다.

> 외부 보안 검토를 받지 않았다. 운영 키에 쓰기 전에 `docs/SECURITY.md`의 한계를 읽을 것.

## 1. 감싸서 실행
```
node packages/env/bin/vault-run.mjs -- npm run dev
node packages/env/bin/vault-run.mjs --file .env.prod.age -- node server.js
```
비밀번호를 한 번 묻는다(글자는 보이지 않는다). 물을 터미널이 없으면 `VAULT_ENV_PASSPHRASE` 환경변수에서 읽는다. 실행하는 프로그램에는 금고 비밀번호를 넘기지 않는다.

## 2. 코드에서 한 줄로
```js
import '@vault/env/load'; // dotenv의 'dotenv/config' 자리
```
`.env.age`가 있으면 풀어 `process.env`에 넣는다. 이미 있는 이름은 덮어쓰지 않는다. 파일이 없으면 조용히 넘어간다(배포 환경에서는 환경변수가 직접 들어온다).

## 3. AI 코딩 도구에 연결 (MCP)
AI가 "이 키를 넣어 주세요"라고 할 때 채팅에 붙여 넣지 않게 한다. AI는 키를 **이름으로만** 쓰고 값은 받지 못한다.

```json
{
  "mcpServers": {
    "vault": {
      "command": "node",
      "args": ["<저장소>/packages/env/bin/vault-mcp.mjs"],
      "env": { "VAULT_ENV_FILE": "<프로젝트>/.env.age", "VAULT_ENV_PASSPHRASE": "<파일 비밀번호>" }
    }
  }
}
```

| 도구 | 하는 일 |
|---|---|
| `list_keys` | 키 이름 목록. 값은 없다 |
| `run_with_keys` | 고른 이름의 값을 환경변수로 넣어 명령을 실행하고, 출력에 값이 찍혀 있으면 `[이름 가림]`으로 바꿔 돌려준다 |
| `request_key` | 없는 키를 사용자에게 요청하는 안내문 |

값을 돌려주는 도구는 일부러 만들지 않았다.

### 한계
- 실행한 명령이 값을 다른 곳으로 보내는 것은 막지 못한다. 명령을 실행해도 되는지는 AI 도구의 권한 창이 묻는다.
- MCP 설정 파일에 파일 비밀번호가 평문으로 들어간다. OS 키체인 연동은 아직 없다. 이 비밀번호는 마스터 비밀번호와 다른 것으로 정할 것.
- 가리기는 값과 똑같은 글자열만 잡는다. 프로그램이 값을 잘라서 찍거나 다른 꼴(base64 등)로 바꿔 찍으면 못 잡는다.
- 6자보다 짧은 값은 가리지 않는다(우연히 겹치는 글자가 많다).

## age만으로 풀기
이 패키지가 없어도 된다.
```
age -d .env.age
```
