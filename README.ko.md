# Vault (가칭)

[English README](README.md)

1인 개발자와 바이브코더를 위한 **키 장부**. API 키, 환경변수, 계정 정보를 메모장에 적어 두는 대신 기기에서 잠가 보관하고, 어디에 쓰이는지·언제 끝나는지·털리면 뭘 바꿔야 하는지를 같이 관리한다.

- 키를 붙여 넣으면 어느 서비스의 무슨 키인지 알아보고, 브라우저에 공개되는 이름(`NEXT_PUBLIC_`, `VITE_`)에 비밀 키를 넣으면 경고한다.
- 꺼내 쓰기: `Ctrl+K` → 이름 → Enter로 복사. `.env` 통째로 넣고 꺼내기.
- 평문 `.env` 없이 실행: `npx keys-kept run -- npm run dev` (npm 패키지 `keys-kept`, 코드는 `packages/env`).
- AI 코딩 도구에는 키 이름만 주고 값은 주지 않는다 (MCP 서버 `npx keys-kept mcp`. Claude Code는 `/plugin marketplace add jwn7/vault-notes` → `/plugin install keys-kept@vault-notes`).
- 사고 모드: 털린 기기나 프로젝트를 고르면 바꿔야 할 키 체크리스트가 나온다.
- 환경 비교표: 키를 행, 환경을 열로 놓고 한 환경에만 빠진 값을 찾는다.
- 개발 흐름 연결(`packages/env`): 깃 브랜치 → 환경, `.env.example` 대조(`vault-check`), 커밋 전 유출 검사(`vault-scan`), GitHub Actions로 올리기(`vault-push`).
- 팀원에게 보내기: 받는 사람의 공개키로 잠근 파일(`docs/TEAM.md`).
- 저장소: 내 Google Drive 또는 내가 고른 폴더.
- 기기에서 암호화(Argon2id + XChaCha20-Poly1305), 회사 서버 없이 내 Google Drive에 암호문만, 백업은 표준 age 파일.

> **외부 보안 검토를 받지 않았다.** 잃거나 새도 다시 발급할 수 있는 키만 넣을 것. 한계는 `docs/SECURITY.md`.

## 이 저장소의 상태
키 장부의 계획 1~6단계 완료(core 136, web 35, env 7, 화면 흐름 17). 남은 것은 외부 작업(OAuth 등록, Android 빌드, 스토어 등록)과 다국어. 문서는 다음 순서로 읽는다.

0. `docs/STRATEGY.md` — 무엇을 만드는가, 계획, 보류한 것 (방향은 이 문서가 정한다)
1. `CLAUDE.md` — 작업 규칙 (먼저 읽기)
2. `docs/SPEC.md` — 제품 스펙
3. `docs/DATA-MODEL.md` — 키 계층·타입·백엔드 파일/테이블 구조
4. `docs/ARCHITECTURE.md` — 층·흐름·테스트 전략
5. `docs/ROADMAP.md` — 단계별 체크리스트 (0단계부터)
6. `docs/WIREFRAMES.md` — 화면 설명 + 캔버스 링크
7. `docs/DESIGN.md` — 디자인 토큰·컴포넌트 규칙 (UI 구현 전 읽기)
8. `packages/core/src/` — 타입과 `SyncBackend` 인터페이스, crypto 구현 가이드
9. `supabase/migrations/0001_init.sql` — Pro 백엔드 스키마 (6단계에서 적용)

## 시작하기
```bash
pnpm i
pnpm -r test            # core + web + env
pnpm --filter web dev   # http://localhost:5173
```
- 처음 실행하면 마스터 비밀번호를 정하고 복구 키 12단어를 받는다. 기본은 **로컬 전용**(IndexedDB에 암호문만).
- Google Drive 동기화: `apps/web/.env`에 `VITE_GOOGLE_CLIENT_ID` (Cloud Console, 웹 클라이언트, `drive.file`) → 설정 > 동기화 > Google Drive 연결.
- Pro(Supabase): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` + `supabase db push` + Auth Google provider → 설정 > 업그레이드. `supabase functions deploy backup-mail`로 메일 백업.
- 백업: 설정 > 백업 > 파일로 내려받기 → `vault-YYYY-MM-DD.age`. `age -d vault-YYYY-MM-DD.age > notes.json` 으로 앱 없이 복호화.
- 모바일: PWA로 설치(브라우저 메뉴 > 홈 화면에 추가). Tauri 네이티브는 `docs/MOBILE.md`.

## 기술 스택
| 층 | 선택 |
|---|---|
| UI | React 19 + Vite + TypeScript, PWA → Tauri 2 (데스크톱·모바일) |
| 암호화 | libsodium-wrappers-sumo (Argon2id, XChaCha20-Poly1305), age-encryption (백업) |
| 로컬 저장 | Dexie (IndexedDB) → Tauri SQLite |
| 동기화 | Google Drive API (`drive.file`) 기본 / Supabase (Pro) |
| 편집기 | CodeMirror 6 (마크다운, `/` 명령, `[[` 자동완성) |
| 상태 | Zustand |
| 테스트 | Vitest, Playwright |
| 패키지 | pnpm workspace |

## 위협 모델
막는 것: Drive/Supabase 유출, 내부자, 메일함 유출, 분실한 잠긴 기기, 네트워크 도청.
못 막는 것: 잠금 해제된 기기의 악성코드, 약한 비밀번호, 메타데이터(메모 수·크기·수정 시각), 사용자가 평문으로 내보낸 파일.

## 라이선스
- **앱과 core** (`apps/`, `packages/core`, `supabase/`): [AGPL-3.0-only](LICENSE). 쓰고, 읽고, 고칠 수 있습니다. 고친 버전을 네트워크 서비스로 운영하면 사용자에게 그 소스를 공개해야 합니다.
- **`keys-kept`** (`packages/env`, npm 패키지)와 **Claude Code 플러그인** (`plugins/keys-kept`): [MIT](packages/env/LICENSE). 상업용·비공개 프로젝트를 포함해 어디서든 쓸 수 있습니다.
- 2026-11-26 이전에 공개된 코드는 MIT로 배포됐고, 그 버전은 계속 MIT로 쓸 수 있습니다.

버전과 바뀐 점: [CHANGELOG.md](CHANGELOG.md). 배포하는 방법: [docs/RELEASING.md](docs/RELEASING.md).
