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

## 4.5단계 — 다듬기 (실사용 전 점검)
- [x] 잠그기 전 미저장 입력 저장 (`lockNow`), 저장 실패 표시·재시도
- [x] 버전 기록 5분 구간 묶기 (20칸이 20초 만에 차던 문제)
- [x] 메모를 지운 뒤 다른 메모를 열면 본문이 비던 문제, 메모가 열려 있으면 PC "새 메모" 버튼이 사라지던 문제
- [x] 앱 안 대화상자·토스트(되돌리기), 편집기 체크박스·태그·링크 표시, 읽기 폭 설정
- [x] 설정 화면 스크롤·메뉴 현재 위치, 모바일 편집 상단 바, 모바일 태그 칩, 다크 모드 주 버튼 대비
- [x] 코드 투어 `.tours/` (언어 기초, 데이터 모델)
- [x] "AI가 만든 티" 걷어내기: 문서와 도장 방향(색·글꼴·도장 로고), 카드 상자 제거, 가운뎃점·줄표 문구 정리 — `docs/DESIGN.md`
- [x] 모바일 UI 가이드 23항목 점검 반영: 잉크색 주 버튼, 비활성 버튼 구별, 스위치, 단계 표시, 뒤로/완료 역할 분리, 모바일 시트
- [x] 글꼴 자체 호스팅 (Google Fonts 요청 제거)
- 다음 고도화 후보와 하지 않을 것: `docs/IDEAS.md`
- [x] 새 기기에서 Drive의 볼트 열기 (로컬에서 만든 열쇠를 첫 동기화 때 올림, 다른 볼트면 멈춤)
- [x] Google 로그인 창: 탭 세션 동안 토큰 유지, 계정 힌트, 자동 동기화는 창을 띄우지 않고 "Drive 다시 연결"
- [x] 흰색 기반 디자인, 보기 방식(목록·카드·캘린더), 빠른 메모, 메모 일정 날짜
- [x] Playwright E2E 7개 (처음 설정, 약한 비밀번호 거절, 잠그기 전 저장, 틀린 비밀번호, 빠른 메모·검색, 캘린더, 되돌리기)
- [x] 패스키 잠금 해제, zxcvbn 비밀번호 강도, 자동 로컬 백업, 여러 단어 검색, 앱 아이콘 바로가기
- [x] 패스키·자동 백업 자동 검증: Chrome 가상 인증기(PRF)와 브라우저 안 가상 폴더로 E2E 2개 추가 (총 9개)
- [x] 화면 구조 개편: PC 상단 바 제거·사이드바 통합, 캘린더를 작은 달력 + 일정 목록으로, 빈 편집기 안내
- [x] 두 기기 동기화 E2E: 가짜 Drive로 "로컬 시작 → Drive 연결 → 새 기기에서 불러오기 → 서로 반영 → 틀린 비밀번호 거절" (총 10개)
- [x] 앱 아이콘 PNG 192/512를 새 인장으로 (`node apps/web/scripts/icons.mjs`)
- [x] 디자인 캔버스: PC 메인·모바일 목록을 새 구조로, PC·모바일 캘린더 화면 추가
- [x] 왜 쓰는가와 KPI 정리(`docs/KPI.md`), 기기 안에서만 세는 사용 수치(설정 > 내 사용)
- [x] 오늘 화면(첫 화면): 오늘 일정·할 일 모음·다가오는 일정·다시 볼 메모, 잠금 해제 후 빠른 메모에 커서
- [x] 빠른 메모의 날짜 말("내일 치과 3시"), 관련 메모, 틀(하루 계획·회의록·학습 노트), 서버가 보는 모습 (E2E 총 12개)
- [x] 버그: 편집 중에 사이드바 항목을 누르면 클릭이 사라지던 문제 (항목 컴포넌트가 매번 새로 만들어짐)
- [x] 보안 강화: 배포 빌드에 CSP(허용 목록 밖 전송·바깥 스크립트·eval 차단, `scripts/csp-check.mjs`로 검증), CI 액션 해시 고정·읽기 전용 토큰·`pnpm audit`, 새 버전 7일 대기 (`docs/SECURITY.md`)
- [x] 크기 감추기(암호화 전 구간 채우기, 형식 호환)와 되돌리기 감지(옛 암호문을 덮어쓰지 않고 서버를 고침, 하루 한 번 전체 확인). core 테스트 107개
- [ ] 승인 후 진행할 방어: 기기 간 상태 요약, 열쇠 확약, 가짜 금고, 빌드 지문
- [ ] 사람 손이 필요한 확인: 실제 지문/Windows Hello로 패스키 한 번, 실제 Google 계정으로 두 기기 한 번
- [ ] 디자인 캔버스에 카드 보기 화면 추가 (캘린더는 추가함)

## 5단계 — 출시 준비 (주말 3)
- [ ] Tauri 2 Android 빌드, 생체인증 키 저장(`KeyStorage.keychain`) — 절차는 `docs/MOBILE.md`. Rust·Android SDK 필요(CI 밖)
- [ ] Google OAuth 동의 화면 등록 (Cloud Console, 사람이 함) · [x] 개인정보처리방침 초안 `docs/PRIVACY.md`
- [ ] Play 내부 테스트 → 비공개 테스트
- [x] README 위협 모델 공개

## 6단계 — Pro (이후)
- [x] `sync/supabase/SupabaseBackend.ts` + Realtime (가짜 클라이언트 테스트; 실제 supabase-js 연결은 Pro UI에서)
- [ ] `supabase/migrations/0001_init.sql` 적용, RLS 테스트 — `0002_put_item.sql`(원자적 version 비교), `0003_backups_bucket.sql` 추가. `supabase start`로 적용·검증은 미실행
- [x] Edge Function `backup-mail` (Resend, 40MB 체크, Storage 링크 대체) — 코드만, 배포·실발송 미검증
- [ ] pg_cron 주간 트리거 → 클라이언트에 "백업 요청" 푸시 (서버는 age 파일을 만들 수 없으므로 클라이언트가 생성)
- [ ] Play 결제 구독, 첨부파일(Storage 청크 암호화) — 앱의 Pro 전환(Supabase Google 로그인 → 백엔드 교체 → Realtime)은 구현됨, 결제는 미구현
- [ ] Tauri 데스크톱 패키징, iOS

## 하지 않기로 한 것
- 서버 검색, 공유 링크, 공동편집, 서버 AI — 제로-널리지 위반
- Supabase Vault/pgsodium
- Drive `appDataFolder`(숨김 폴더) — 약관 회색지대, `drive.file` 사용
- Gmail SMTP 직접 발송 (PWA에서 불가; Tauri에서 "고급 옵션"으로 나중에)
