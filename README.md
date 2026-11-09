# Vault (가칭)

개발자도 못 보는 메모장. 기기에서 잠그고(Argon2id + XChaCha20-Poly1305), 내 Google Drive로 PC·폰 동기화, 백업은 표준 age 파일.

## 이 저장소의 상태
0~6단계 코드 완료(테스트 94개). 외부 작업(OAuth 등록, Supabase 배포, Android 빌드, Play 등록)만 남음. 문서는 다음 순서로 읽는다.

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
pnpm -r test            # core 89개 + web 5개
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
MIT. [LICENSE](LICENSE) 참고.
