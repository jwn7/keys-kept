# 알릴 글 초안

올리는 것은 사람이 한다(계정이 필요하고, 댓글에 답해야 한다). 올리기 전에 확인할 것:
- [ ] `npm view keys-kept version`이 나온다 (npm 배포)
- [ ] 웹 데모 링크가 열린다 (GitHub Pages)
- [x] 저장소 이름을 `keys-kept`로 바꿨다 (2026-11-26, 주소 반영함)
- [ ] README 첫 화면의 데모 그림이 GitHub에서 움직인다

원칙: 한계(외부 보안 검토 없음, MCP가 막지 못하는 것)를 먼저 말한다. 보안 도구는 과장하면 그 지점부터 공격받는다. 하루에 한 곳씩, 댓글에 바로 답할 수 있는 날에 올린다.

---

## 1. Show HN (news.ycombinator.com/submit)

**Title** (80자 이내)
```
Show HN: Keys Kept – let AI coding tools use your API keys without seeing them
```

**Text**
```
I kept pasting API keys into chat when Claude Code or Cursor asked for them, and they ended up in transcripts and logs. Keys Kept is my attempt at a better habit.

It has two parts:

1. A local-first key ledger (web app, PWA). Keys are encrypted on the device (libsodium, Argon2id; no custom crypto) and sync as ciphertext to your own Google Drive or a folder. It recognises pasted keys (provider, live vs test, safe-to-publish), flags secrets under browser-exposed names like NEXT_PUBLIC_, compares environments, and has an "incident mode": pick the laptop or service that leaked and get the list of keys to rotate.

2. keys-kept, an MIT npm package with an MCP server. The AI gets key names (list_keys) and can run a command with chosen keys injected as env vars (run_with_keys). Values never enter the conversation, and any value printed in the output comes back as [NAME hidden]. If a key is missing, request_key tells the user to add it in the app instead of pasting it. A .vault.yml in the repo maps git branches to environments and can turn AI access off per project.

Key files are standard age files, so `age -d` opens them without this project.

Limits, honestly: no external security review yet. Masking matches exact strings only, and a command you allow can still send a value somewhere. The threat model and what it does not cover are in SECURITY.md.

Repo: https://github.com/jwn7/keys-kept
Try the app in the browser (data stays in your browser): https://jwn7.github.io/keys-kept/
Claude Code plugin: /plugin marketplace add jwn7/keys-kept

I'd especially like feedback on the MCP design and the threat model.
```

---

## 2. Reddit

### r/ClaudeAI (또는 r/vibecoding, r/cursor)
**Title**
```
I stopped pasting API keys into Claude Code: an MCP server that gives it key names, not values
```
**Body**
```
Every time Claude Code needed a Stripe or OpenAI key, I pasted it into the chat. That puts the key in the transcript, and sometimes it ended up in a file.

So I built keys-kept (MIT): an MCP server + Claude Code plugin.
- list_keys: Claude sees names only
- run_with_keys: runs `npm test` etc. with the keys injected; any value in the output is replaced by [NAME hidden]
- request_key: when a key is missing, it tells you to add it in the app, not in chat
- .vault.yml picks the environment per git branch and can turn AI access off for a project

/plugin marketplace add jwn7/keys-kept
/plugin install keys-kept@keys-kept

The keys live in an encrypted, local-first ledger app (AGPL) that also tracks where each key is used and what to rotate after a leak.

Not externally audited yet, and it can't stop a command you approve from sending a value somewhere. Feedback welcome, especially on what would make you trust it.

Repo: https://github.com/jwn7/keys-kept
```

### r/selfhosted (앱 중심)
**Title**
```
Keys Kept: a local-first, end-to-end encrypted ledger for API keys (syncs ciphertext to your own Drive or folder)
```
본문은 Show HN 글의 1번 단락과 "Limits" 단락을 쓴다. MCP는 한 줄로만.

---

## 3. GeekNews (news.hada.io/write)

**제목**
```
Keys Kept - AI 코딩 도구가 API 키를 쓰되 값은 보지 못하게 하는 키 장부
```
**본문**
```
Claude Code나 Cursor가 "이 키를 넣어 주세요"라고 할 때마다 채팅에 키를 붙여 넣던 습관을 고치려고 만들었습니다.

- MCP 서버(npm keys-kept, MIT): AI는 키 이름만 받고, 명령을 실행할 때 값은 환경변수로만 들어갑니다. 출력에 값이 찍히면 [이름 hidden]으로 가립니다. 없는 키는 채팅이 아니라 앱에 넣으라고 안내합니다.
- 키 장부 앱(AGPL): 기기에서 암호화하고(libsodium, Argon2id), 암호문만 내 Google Drive나 폴더로 동기화합니다. 붙여 넣은 키가 어느 서비스의 무슨 키인지 알아보고, NEXT_PUBLIC_ 같은 공개 이름에 비밀 키를 넣으면 경고합니다. 노트북을 잃어버리면 그 기기에 있던 키만 추려 주는 사고 모드가 있습니다.
- 키 파일은 표준 age 형식이라 이 프로젝트가 없어도 age -d로 열립니다.

한계: 외부 보안 검토는 아직 받지 못했습니다. 가리기는 값과 똑같은 글자만 잡고, 허락한 명령이 값을 다른 곳으로 보내는 것은 막지 못합니다.

저장소: https://github.com/jwn7/keys-kept
웹에서 써 보기: https://jwn7.github.io/keys-kept/
```

---

## 4. 목록에 올리기

### awesome-mcp-servers (github.com/punkpeye/awesome-mcp-servers)
"Security" 분류에 한 줄 PR. 저장소의 CONTRIBUTING 형식(언어·범위 아이콘)을 먼저 확인하고 맞춘다.
```
- [jwn7/keys-kept](https://github.com/jwn7/keys-kept/tree/main/packages/env) 📇 🏠 - Lets AI coding tools use API keys from an encrypted local vault by name only; values are injected as env vars and masked in output.
```

### 공식 MCP 레지스트리
`docs/RELEASING.md`의 6단계 (`mcp-publisher publish`). npm 배포 뒤에.

---

## 올린 뒤
- 첫 두 시간은 댓글에 답한다. 보안 질문에는 SECURITY.md의 해당 줄을 링크한다.
- 나온 지적은 이슈로 만들고, 고친 것은 CHANGELOG에 적는다.
- 같은 글을 여러 곳에 같은 날 올리지 않는다.
