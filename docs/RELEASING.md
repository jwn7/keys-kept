# 배포와 버전 관리

이 저장소에는 따로 버전을 매기는 것이 둘 있다. 바뀐 점은 루트 `CHANGELOG.md`에 적는다.

| 대상 | 버전이 적힌 곳 | 라이선스 | 태그 |
|---|---|---|---|
| 앱 (`apps/web`, `packages/core`) | 두 `package.json`의 `version` (같이 올린다) | AGPL-3.0-only | `app@0.1.0` |
| `keys-kept` (`packages/env`) + 플러그인 (`plugins/keys-kept`) | `packages/env/package.json`, `packages/env/server.json`(두 곳), `plugins/keys-kept/.claude-plugin/plugin.json`, `bin/vault-mcp.mjs`의 `serverInfo.version` | MIT | `keys-kept@0.1.0` |

## 버전 규칙 (Semantic Versioning)
- 고친 것만: 끝자리 (0.1.0 → 0.1.1)
- 기능 추가: 가운데 (0.1.x → 0.2.0). 1.0 전에는 깨지는 변경도 여기서 올리고 CHANGELOG에 **Breaking**으로 적는다.
- 플러그인의 `.mcp.json`은 `keys-kept@0.1`처럼 가운데 자리까지 고정한다. 0.2.0을 내면 플러그인도 같이 올린다.

## keys-kept 배포 순서
1. `CHANGELOG.md`에 새 버전 항목을 쓴다.
2. 위 표의 버전 자리를 모두 같은 값으로 바꾼다.
3. `pnpm --filter keys-kept test`가 통과하는지 본다. `cd packages/env; npm pack --dry-run`으로 들어갈 파일을 본다(bin, src, README, LICENSE만).
4. 커밋하고 푸시한 뒤 배포한다 (npm 로그인은 사람이 한다):
   ```
   cd packages/env
   pnpm publish --access public
   ```
   다른 폴더에 커밋 안 된 변경이 있어 pnpm이 막으면, `packages/env`가 깨끗한지(`git status packages/env`) 확인하고 `--no-git-checks`를 붙인다.
5. 태그: `git tag keys-kept@0.1.0` → `git push origin keys-kept@0.1.0`
6. MCP 공식 레지스트리 (처음 한 번 `mcp-publisher login github`, GitHub 로그인은 사람이 한다):
   ```
   cd packages/env
   mcp-publisher publish
   ```
7. 확인: `npm view keys-kept version`, 빈 폴더에서 `npx -y keys-kept` 가 명령 목록을 보여 주는지.

## 앱 배포

### 지금: 웹 데모 (https://jwn7.github.io/keys-kept/)
`.github/workflows/pages.yml`이 main에 올라온 앱을 `VITE_DEMO=1`로 빌드해 올린다. 잠금 화면에 "진짜 키를 넣지 마세요"가 뜬다. 데모라고 부르는 이유:
1. **외부 보안 검토가 없다.**
2. **주소(origin)를 남과 같이 쓴다.** `jwn7.github.io`는 이 계정의 모든 GitHub Pages가 함께 쓰는 origin이다. 같은 origin의 다른 페이지는 이 앱의 저장소(IndexedDB: 암호문과 감싼 열쇠)를 읽고 바꿀 수 있다. 암호문이라 바로 새지는 않지만, 실제로 쓰는 앱은 자기만의 origin에 둔다.
3. **동기화가 폴더뿐이다.** Google OAuth 클라이언트가 없어서 Drive 동기화가 꺼져 있다.

### 실제로 쓰게 하려면 (순서대로)
1. **도메인** (사람이 한다): 예) `keyskept.dev`, `app.<내 도메인>`. GitHub 저장소 Settings > Pages > Custom domain에 넣고 DNS에 CNAME `jwn7.github.io`. HTTPS 강제를 켠다. 그러면 이 앱만의 origin이 생긴다.
2. **Google OAuth 클라이언트** (사람이 한다): Google Cloud Console > API 및 서비스 > OAuth 동의 화면(외부) → 사용자 인증 정보 > OAuth 클라이언트 ID(웹). 승인된 JavaScript 원본 = 1의 도메인. 범위는 `drive.file`(앱이 만든 파일만). 나온 클라이언트 ID를 저장소 Settings > Secrets and variables > Actions > **Variables**에 `VITE_GOOGLE_CLIENT_ID`로 넣는다(비밀값이 아니다: 브라우저에 그대로 보이는 값). 클라이언트 secret은 쓰지 않고 어디에도 두지 않는다.
3. **실제 빌드로 바꾸기** (Claude가 한다): pages.yml에서 도메인이면 `VITE_BASE=/`, `VITE_DEMO` 끔, `VITE_GOOGLE_CLIENT_ID`를 변수에서 넣기. CSP 허용 목록은 이미 Google 주소를 갖고 있다(`apps/web/vite.config.ts`). 데모 안내 문구 대신 설정의 "외부 검토 전" 안내만 남긴다.
4. **계정 지키기** (사람이 한다): GitHub·npm 2단계 인증, main 브랜치 보호(직접 푸시 금지, CI 통과 필수). 웹 앱은 서버가 주는 코드를 믿는 구조라(`docs/SECURITY.md`), 배포 권한이 곧 사용자 키의 안전이다.
5. **외부 보안 검토**: 검토를 받거나 공개적으로 요청한다(`SECURITY.md`의 신고 경로). 그 전까지 README의 "다시 발급할 수 있는 키만" 안내를 유지한다.
6. (선택) **설치형 앱**: Tauri 데스크톱·Android(`docs/MOBILE.md`). 코드를 매번 서버에서 받지 않아 4의 위험이 줄어든다.

1·2를 마치면 3은 한 번의 커밋이다. 그 전에도 혼자 쓰는 것은 된다: 데모 주소를 앱으로 설치하고(주소창의 설치 단추) 폴더 동기화로 기기를 잇되, 다시 발급할 수 있는 키만 넣는다.
