# Vault — 제품 스펙 (v1)

## 한 줄 정의
개발자도 못 보는 메모장. 메모는 기기 안에서 잠기고, 사용자 본인의 Google Drive로 PC·폰이 동기화되며, 백업은 표준 age 파일로 메일함에 남는다.

## 사용자 약속 (앱 소개에 그대로 쓸 문장)
- 내용은 내 기기에서만 열린다. 서버·개발자·Google은 암호문만 본다.
- 인터넷 없이도 쓰고 읽고 검색한다. 인터넷은 동기화와 백업에만 쓴다.
- 앱이 사라져도 백업은 열린다 (`age -d backup.age`).
- 그래서 못 하는 것: 공유 링크, 서버 검색, 공동편집, 서버 AI.

## 플랫폼
| | v1 | v1.5 | v2 |
|---|---|---|---|
| PC | PWA (브라우저 설치) | Tauri 2 데스크톱 앱 | |
| Android | PWA | Tauri 2 → Play Store | |
| iOS | PWA (Safari) | | Tauri 2 → App Store |

## 1. 계정과 열쇠

### 1.1 가입/첫 실행
1. Google 로그인 (Drive 동기화용, `drive.file` 스코프). 로그인 없이 "로컬 전용"으로도 시작 가능.
2. 마스터 비밀번호 설정 (12자 이상 권장, zxcvbn 점수 3 이상 요구).
3. 복구 키 12단어(BIP39 영단어) 표시 → "적어두었습니다" 확인. 복구 키로 비밀번호를 재설정할 수 있다 (= root key를 복구 키로도 한 번 더 감싸서 저장).
4. 열쇠 생성: 비밀번호 → Argon2id → root key. 데이터 키(items key) 랜덤 생성 → root key로 감싸서 동기화 백엔드에 저장.

### 1.2 잠금 해제
- **PC**: 매번 비밀번호. root key는 메모리에만. 자동 잠금 5/15/30분, 기본 15분.
- **모바일**: 처음 비밀번호 → root key를 OS 키체인(Android Keystore / iOS Keychain)에 저장 → 이후 지문/얼굴. 5회 실패 또는 새 기기면 비밀번호.
- 잠금 시 메모리의 복호화된 메모와 키를 모두 비운다. 로컬 DB에는 암호문만 남아있다.

### 1.3 비밀번호 변경
- 새 root key로 items key만 다시 감싼다. 메모 전체 재암호화 없음.

### 1.4 새 기기 연결
- Google 로그인 → 백엔드에서 `items_keys`(감싼 데이터 키 + KDF salt/params) 다운로드 → 비밀번호 입력 → 같은 root key 유도 → 데이터 키 풀림 → 암호문 전체 다운로드.
- QR 연결은 v2 (Pro에서 Supabase 쓸 때 기기 등록용).

## 2. 메모

### 2.1 기본
- 마크다운 본문. 제목은 첫 줄 `# ` 또는 별도 필드.
- 폴더(1단계), 태그(본문 `#태그` 자동 인식 + 수동), 고정(핀), 휴지통(30일 후 물리 삭제 → tombstone만 남김).
- 자동 저장: 입력 후 1초 디바운스 → 로컬 암호화 저장 → outbox.

### 2.2 편집기
- `/` 명령: 제목1-3, 체크박스, 글머리, 번호, 코드 블록, 표, 구분선, 오늘 날짜.
- `[[` 입력 시 메모 제목 자동완성 → `[[제목]]` 링크. 없는 제목이면 클릭 시 새 메모.
- 백링크 패널: 현재 메모를 `[[ ]]`로 참조하는 메모 목록 (기기에서 인덱스 계산).
- 체크박스 클릭 토글, 코드 블록 하이라이트(PC), 이미지 붙여넣기는 v2(첨부).

### 2.3 탐색
- 커맨드 팔레트 `Ctrl+K`: 메모 제목·본문 검색 + 명령(새 메모, 오늘의 메모, 동기화, 백업, 잠금).
- 검색은 복호화된 메모 메모리 인덱스에서. 수천 개까지 단순 문자열, 그 이상은 MiniSearch 도입 검토.
- 오늘의 메모: `YYYY-MM-DD` 제목 메모를 열거나 만든다.
- 목록 정렬: 수정순(기본)/생성순/제목. 핀 고정 상단.

### 2.4 버전 기록
- 메모당 최근 20개 버전 보관(암호문 그대로). "되돌리기"는 새 버전을 만든다.
- 버전은 동기화하지 않는다(기기 로컬). v2에서 Pro 사용자는 동기화 검토.

## 3. 동기화

### 3.1 공통 규칙
- 로컬 우선. 모든 읽기·쓰기는 로컬 DB. 동기화는 백그라운드.
- 단위: 메모 1개 = 암호문 블롭 1개 (`id`, `updatedAt`, `version`, `deletedAt`, `nonce`, `ciphertext`, `itemsKeyId`).
- 증분: `updatedAt > lastSyncAt`인 것만. 전체 재다운로드는 새 기기 또는 "강제 재동기화"에서만.
- 충돌: 같은 `id`, 양쪽 `version` 분기 → `updatedAt` 큰 쪽 채택, 진 쪽은 `title + " (충돌 사본 — 기기명 날짜)"` 메모로 생성하고 목록에 빨간 표시.
- 삭제: `deletedAt` 설정 후 동기화. 30일 지나면 내용은 비우고 tombstone만 유지.
- 상태 표시: `동기화됨 · N분 전` / `오프라인 · 변경 N개 대기` / `충돌 사본 N개` / `동기화 오류 (재시도)`.

### 3.2 Google Drive (기본, 무료)
- 스코프: `https://www.googleapis.com/auth/drive.file` (non-sensitive). 사용자가 고른 폴더(기본 "Vault") 안에만 접근.
- 파일 구조: `Vault/vault.json`(메타: 버전, itemsKeys) + `Vault/notes/<id>.enc`(메모 암호문 1개 = 파일 1개).
- 변경 감지: 앱 포커스 시 + 30초 폴링으로 `files.list(modifiedTime > lastSyncAt)`. Drive Changes API는 v1.5.
- 한도: Drive 15GB 무료는 사용자 몫. 파일 수 수천 개까지 OK.
- 토큰: refresh token은 PC에선 메모리/세션, 모바일에선 키체인.
- 정책 메모: Drive 약관의 "앱 콘텐츠 백업" 조항 때문에 숨김 `appDataFolder`가 아니라 **사용자가 보는 폴더 + `drive.file`**을 쓴다. 사용자가 자기 파일을 자기 Drive에 동기화하는 형태.

### 3.3 Supabase (Pro, 유료)
- 테이블 `items`, `items_keys`, `devices` + RLS `user_id = auth.uid()`. 스키마는 `docs/DATA-MODEL.md`, SQL은 `supabase/migrations/`.
- Realtime 구독으로 즉시 반영. 첨부파일은 Storage 버킷(암호화 청크). 주간 자동 메일 백업(Edge Function + Resend).
- Google 로그인을 Supabase Auth의 Google provider로 그대로 쓴다 (계정 하나).

### 3.4 SyncBackend 인터페이스
`packages/core/src/sync/SyncBackend.ts` 참고. `list(since)`, `get(id)`, `put(blob)`, `delete(id)`, `getKeys()`, `putKeys()`. Drive/Supabase 구현체는 이 인터페이스만 만족하면 된다. 메모리 구현(`MemoryBackend`)으로 동기화 엔진을 테스트한다.

## 4. 백업과 복구
- 내보내기: 전체 메모(복호화) → JSON(`docs/DATA-MODEL.md` §백업 포맷) → age 패스프레이즈 암호화 → `vault-YYYY-MM-DD.age`.
- 무료: 파일 저장 또는 OS 공유 시트(폰에서 Gmail 등으로 바로). PC는 다운로드.
- Pro: 매주 Edge Function이 아니라 **클라이언트가** 만든 age 파일을 Edge Function에 업로드 → Resend로 사용자 메일에 첨부 발송. 서버는 age 파일을 못 연다. 40MB 초과 시 Storage 서명 URL(7일) 링크로 대체.
- 복구: 잠금 화면 "백업 파일로 복구" → age 파일 + 백업 비밀번호 → 메모 병합(id 같으면 `updatedAt` 큰 쪽).
- 옵시디언 호환 내보내기: `폴더/제목.md` 구조 zip, 평문. 경고 문구 표시.
- 마크다운 가져오기: 폴더 선택 → `.md` 파일을 메모로.

## 5. 설정
- 동기화: Google Drive 연결/해제, 지금 동기화, Pro 업그레이드(Play 결제, v1.5), 연결된 기기.
- 백업: 받을 메일, 자동 주기(Pro), 지금 만들기, 복구.
- 보안: 자동 잠금 시간, 비밀번호 변경, 복구 키 보기(비밀번호 재입력 후), 모바일 생체인증 on/off.
- 내 데이터: 옵시디언 내보내기, 가져오기, **계정과 모든 데이터 삭제**(Play 정책 필수: Drive 폴더 파일 + Supabase 행 + 로컬 DB 전부).
- 모양: 라이트/다크/시스템, 글꼴 크기, 편집기 폭.

## 6. 비기능
- 첫 로드 후 메모 1,000개 복호화 + 목록 표시 < 1초 (중급 폰 기준).
- Argon2id 파라미터: `opslimit=3, memlimit=64MB` (libsodium `MODERATE`). 저사양 폰에서 1초 내.
- 오프라인에서 모든 CRUD 가능. 네트워크 복귀 시 outbox 자동 플러시.
- 접근성: 모든 버튼 44px 이상, 키보드만으로 PC 전체 조작, 스크린리더 라벨.
- 로그에 평문 메모·키를 절대 남기지 않는다 (ESLint 규칙으로 `console.log(note` 패턴 금지).

## 7. 위협 모델 (README에 공개)
막는 것: Drive/Supabase 유출, 내부자, 메일함 유출, 분실한 잠긴 기기, 네트워크 도청.
못 막는 것: 잠금 해제된 기기의 악성코드, 약한 비밀번호, 메타데이터(메모 수·크기·수정 시각), 사용자가 평문으로 내보낸 zip.

## 8. Play Store 체크리스트
- [ ] 개인정보처리방침 URL (E2EE 명시, 수집 항목: Google 계정 이메일, 암호문)
- [ ] Data Safety 폼: "데이터 암호화됨 · 전송 중 암호화 · 삭제 요청 가능"
- [ ] 앱 내 계정 삭제 기능 + 웹 삭제 요청 URL
- [ ] OAuth 동의 화면 (drive.file, 기본 검증)
- [ ] Target API 최신, 64-bit
- [ ] 스크린샷 8장 (와이어프레임 화면 기준)
