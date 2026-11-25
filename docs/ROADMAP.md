# 로드맵 (주말 단위)

체크박스는 Claude Code가 작업 후 갱신한다.

## 지금 하는 일 (`docs/STRATEGY.md`의 계획: 1인 개발자를 위한 키 장부. 이 순서대로만)
- [x] 1. 키 알아보기: 키 모양 인식, `.env` 읽기·쓰기, 공개 이름에 비밀 키 경고 (`packages/core/src/secrets/`)
- [x] 2. 키 항목: `Note.secret`(값·환경·쓰이는 곳). 프로젝트 = 폴더, 만료일 = 날짜. `.env` 넣기·꺼내기 계산, 살펴볼 것 표시, 사고 모드 계산, 평문 내보내기에서 값 제외 (`secrets/ledger.ts`, core 테스트 136개)
- [x] 3. 화면과 꺼내 쓰기: 키 줄(종류·가린 값·살펴볼 것·복사), 키 상세(값 가리기·환경·쓰이는 곳·재발급 페이지), `Ctrl+K`에서 Enter = 값 복사, `.env` 넣기 창과 복사·내려받기, `NAME=value` 빠른 입력. 디자인 캔버스도 키 장부로 다시 그림 (E2E 15개)
- [x] 4. 꺼내 쓰는 패키지 `packages/env`: 앱의 "암호화해서 내려받기"(`.env.age`, 표준 age), `vault-run -- <명령>`, `import '@vault/env/load'`, AI 도구용 MCP 서버(이름으로 요청, 값은 AI에게 안 감, 출력의 값은 가림). 테스트 7개
  - 남은 것: MCP 비밀번호를 OS 키체인에서 받기(지금은 설정 파일의 환경변수), npm 배포
- [x] 5. 첫 화면을 장부로: "살펴볼 것"에 공개될 수 있는 키·만료 임박 키가 맨 위, 쓰이는 곳을 안 적은 키 수
- [x] 6. 사고 모드: 털린 기기·서비스·프로젝트를 고르면 바꿀 키 체크리스트, 값을 바꾸면 스스로 체크, 안 적은 키는 "모름" (E2E 17개)
- [x] 버그 2건: 키를 차례로 열면 앞 키의 값이 다음 키에 저장되던 문제, 입력 칸에서 벗어나며 첫 화면의 줄을 누르면 클릭이 사라지던 문제 (둘 다 테스트로 고정)
- [x] 8. 환경 비교표: 키를 행, 환경을 열로. 빠진 칸은 붉게, 누르면 그 환경에 새 키. 캔버스에도 추가 (E2E 18개)
  - 남은 것: 화면 전체의 분위기 개편(색·밀도)은 방향을 정한 뒤
- [x] 9. 키 생성기: 32바이트 base64url / 16진수 / 비밀번호 24자, 치우침 없는 글자 고르기
- [x] 10. 개발 흐름 연결 (`packages/env`, 테스트 13개): `.vault.json`의 브랜치 → 환경, `vault-check`(`.env.example` 대조), `vault-scan`(커밋 전에 금고의 실제 값이 든 파일 찾기)
  - [x] GitHub Actions 비밀값으로 올리기: `vault-push github` (사용자의 `gh` 로그인으로, 값은 표준 입력으로). 실제 GitHub에는 올려 보지 않았고 가짜 `gh`로 검증
- [x] 11-1. 폴더 저장소: `FolderBackend`(core) + 설정 > 동기화 > 폴더 (Chrome·Edge 데스크톱). 그 폴더를 Dropbox·iCloud·Syncthing이 옮기게 두면 된다
- [ ] 11-2. WebDAV, S3
- [x] 12-1. 팀 공유 1판: 받는 사람의 공개키로 잠근 파일 주고받기 (age 수신자 모드, 양자내성 혼합 열쇠, 지문 표시, `vault-run`이 개인키로 열기). `docs/TEAM.md`
- [ ] 12-2. 팀 공유 2판: 같이 쓰는 프로젝트 (설계만 있음, 공격 테스트와 승인 후)
- [x] 코드 검토에서 나온 결함 11건 수정: 여러 줄 값 잘림, 환경변수 꼴이 아닌 이름이 내보낼 때 사라짐, Windows 셸 인자 끼어들기, MCP 서버가 `null` 줄에 죽음, 자르기 전에 가리지 않아 값 앞부분이 샘, 겹친 저장이 서로의 칸을 지움, 잠글 때 키 칸 입력 유실, `vault-scan`이 못 읽은 파일을 통과시킴 등 (E2E 20개)
- [x] 13-1. 영어 화면: `i18n/en.ts`, 설정 > 모양에서 전환, 브라우저 언어 따라 자동 선택. 영어 README, `SECURITY.md`(신고 방법과 한계)
- [x] 꺼내기 메뉴: 복사·암호화 내려받기·팀원에게 보내기·평문 내려받기를 단추 하나로 (E2E 22개)
- [ ] 13-2. 출시 준비의 외부 작업 (아래 5단계): Google OAuth 등록, 설치형 빌드, 스토어 등록, 외부 보안 검토
- [x] 디자인 캔버스에 팀 공유 창·꺼내기 메뉴·영어 화면 반영 (보드 3장 추가. 메뉴 항목 아래 한 줄 설명은 앱에도 넣었다)
- [x] 14-1. 캔버스를 사용자 흐름대로 재배치: 열기 → 넣고 맞추기 → 꺼내 쓰기 → 지키기 → 설정. 프로젝트 목록 보드(PC·모바일) 추가, 사이드바에서 "모든 키"·"메모" 제외
- [ ] 14-2. 앱을 프로젝트 먼저 구조로 (캔버스 확인 뒤): 첫 화면을 프로젝트 목록으로, "살펴볼 것"을 띠로, 사이드바 정리
- [ ] 14-3. 메모 기능과 일정·할 일·복습 칸을 남길지 결정

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
- [x] 뜻 검색 실험: 기기 안 임베딩이 지금 검색이 놓친 질의의 95%를 찾음, 1,000개 색인 약 1분 (`experiments/semantic-search/README.md`)
- 보류: 뜻 색인(기기 안 AI 모델). 이유는 `docs/STRATEGY.md`
- 보류: 기기 간 상태 요약(저장소 검증 라이브러리), 열쇠 확약, 가짜 금고, 빌드 지문
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
