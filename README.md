# Vault (가칭)

개발자도 못 보는 메모장. 기기에서 잠그고(Argon2id + XChaCha20-Poly1305), 내 Google Drive로 PC·폰 동기화, 백업은 표준 age 파일.

## 이 저장소의 상태
0단계(모노레포 뼈대)·1단계(암호화 코어) 완료. `pnpm i && pnpm -r test`. 문서는 다음 순서로 읽는다.

1. `CLAUDE.md` — 작업 규칙 (먼저 읽기)
2. `docs/SPEC.md` — 제품 스펙
3. `docs/DATA-MODEL.md` — 키 계층·타입·백엔드 파일/테이블 구조
4. `docs/ARCHITECTURE.md` — 층·흐름·테스트 전략
5. `docs/ROADMAP.md` — 단계별 체크리스트 (0단계부터)
6. `docs/WIREFRAMES.md` — 화면 설명 + 캔버스 링크
7. `docs/DESIGN.md` — 디자인 토큰·컴포넌트 규칙 (UI 구현 전 읽기)
8. `packages/core/src/` — 타입과 `SyncBackend` 인터페이스, crypto 구현 가이드
9. `supabase/migrations/0001_init.sql` — Pro 백엔드 스키마 (6단계에서 적용)

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
