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
아직 공개 배포하지 않는다 (`docs/ROADMAP.md` 13-2: Google OAuth 등록, 설치형 빌드, 외부 보안 검토가 먼저). 정할 때 이 절을 채운다.
