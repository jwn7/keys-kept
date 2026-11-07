# 로드맵 (주말 단위)

체크박스는 Claude Code가 작업 후 갱신한다.

## 0단계 — 뼈대 (반나절)
- [x] pnpm 모노레포: `packages/core`, `apps/web`, `supabase/`, `docs/`
- [x] core: TypeScript strict, Vitest, ESLint(`no-console` + 평문 로그 금지 규칙)
- [x] `model/` 타입 (DATA-MODEL.md 그대로)
- [x] CI: `pnpm -r test` + `age` CLI 설치

## 1단계 — 암호화 코어 (주말 1)
- [x] `crypto/kdf.ts` Argon2id (libsodium `crypto_pwhash`, MODERATE)
- [x] `crypto/aead.ts` XChaCha20-Poly1305 seal/open + AAD
- [x] `crypto/keys.ts` itemsKey 생성·wrap·unwrap, 복구키(BIP39 12단어) 경로
- [x] `store/LocalStore.ts` Dexie: blobs/outbox/versions/meta
- [x] `VaultSession` unlock/lock/save/list — 메모리 백엔드로 전체 라운드트립 테스트
- [x] 벤치: 1,000개 복호화 < 1초

## 2단계 — 동기화 엔진 (주말 1~2)
- [x] `sync/SyncBackend.ts` 인터페이스 + `MemoryBackend`
- [x] `sync/SyncEngine.ts` pull/push/충돌 사본/tombstone/outbox
- [x] 두 기기 시뮬레이션 테스트 6종 (ARCHITECTURE.md 테스트 전략)
- [x] `sync/drive/DriveBackend.ts` — OAuth PKCE(`drive.file`), 폴더 생성, list(since)/get/put
- [x] 폴링 스케줄러 (포커스 + 30초)

## 3단계 — PWA UI (주말 2)
- [x] 잠금 해제 / 첫 실행(비밀번호·복구키) 화면
- [x] 메인: 사이드바 · 목록 · 편집기(CodeMirror 6 마크다운) · 상태 뱃지
- [x] `/` 명령, `[[링크]]` 자동완성, 백링크 패널, `#태그`
- [x] `Ctrl+K` 커맨드 팔레트
- [x] 버전 기록 패널
- [x] 설정: Drive 연결, 자동 잠금, 비밀번호 변경, 복구키
- [x] 서비스워커(오프라인) + manifest (설치 가능)
- [x] 모바일 레이아웃 (390px) — 와이어프레임 4화면

## 4단계 — 백업 (주말 2~3)
- [x] `backup/ageExport.ts` / `ageImport.ts` (`age-encryption`)
- [x] CI에서 `age -d`로 실제 복호화 검증
- [x] 공유/다운로드, 잠금 화면 "백업 파일로 복구"
- [x] 옵시디언 내보내기 zip, 마크다운 가져오기
- [x] 계정·데이터 삭제 흐름 (Drive 폴더 파일 + 로컬)

## 5단계 — 출시 준비 (주말 3)
- [ ] Tauri 2 Android 빌드, 생체인증 키 저장(`KeyStorage.keychain`)
- [ ] Google OAuth 동의 화면 등록, 개인정보처리방침 페이지
- [ ] Play 내부 테스트 → 비공개 테스트
- [ ] README 위협 모델 공개

## 6단계 — Pro (이후)
- [ ] `sync/supabase/SupabaseBackend.ts` + Realtime
- [ ] `supabase/migrations/0001_init.sql` 적용, RLS 테스트
- [ ] Edge Function `backup-mail` (Resend, 40MB 체크, Storage 링크 대체)
- [ ] pg_cron 주간 트리거 → 클라이언트에 "백업 요청" 푸시 (서버는 age 파일을 만들 수 없으므로 클라이언트가 생성)
- [ ] Play 결제 구독, 첨부파일(Storage 청크 암호화)
- [ ] Tauri 데스크톱 패키징, iOS

## 하지 않기로 한 것
- 서버 검색, 공유 링크, 공동편집, 서버 AI — 제로-널리지 위반
- Supabase Vault/pgsodium
- Drive `appDataFolder`(숨김 폴더) — 약관 회색지대, `drive.file` 사용
- Gmail SMTP 직접 발송 (PWA에서 불가; Tauri에서 "고급 옵션"으로 나중에)
