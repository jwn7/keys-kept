# Vault — Claude Code 작업 지침

제로-널리지 암호화 메모 앱. 메모는 기기 안에서만 열리고, 서버(Google Drive / Supabase)와 메일함에는 암호문만 간다.
PC(웹/Tauri)와 모바일(Android 우선)에서 같은 코드를 쓴다. 상세 스펙은 `docs/`에 있다 — **코드를 쓰기 전에 `docs/SPEC.md`와 `docs/DATA-MODEL.md`를 읽는다.**

## 현재 상태
- 0~4단계 완료: core(crypto/store/sync/backup/session, 테스트 98개) + `apps/web` PWA(잠금·메인·편집기·팔레트·설정·모바일). Drive 연결은 `apps/web/.env`의 `VITE_GOOGLE_CLIENT_ID`가 필요. 6단계 Pro(`SupabaseBackend`, `put_item` RPC, `backup-mail` Edge Function, 앱의 Pro 전환 `apps/web/src/pro/`)도 코드 완료. 남은 것은 외부 작업: Google OAuth 등록, Tauri Android 빌드(`docs/MOBILE.md`), Supabase 적용·배포, Play 등록.
- 왜 쓰는가·KPI·자동으로 도와주는 것: `docs/KPI.md` (오늘 화면, 할 일 모음, 날짜 말, 관련 메모, 복습은 `apps/web/src/app/assist.ts`의 순수 함수)
- 시장에서의 자리와 다음 기술 방향(암호화된 뜻 색인): `docs/STRATEGY.md`
- 와이어프레임·최종 디자인: `docs/WIREFRAMES.md`, 토큰·규칙: `docs/DESIGN.md` (UI 작업 전 필독)

## 절대 규칙 (바꾸려면 사용자에게 먼저 확인)
1. **암호화 원시 함수를 직접 구현하지 않는다.** `libsodium-wrappers-sumo`만 쓴다. Argon2id = `crypto_pwhash`, 항목 암호화 = `crypto_aead_xchacha20poly1305_ietf_*`.
2. **서버로 나가는 모든 바이트는 `packages/core/src/sync/` 를 통과하고, 그 전에 `crypto/`로 암호화돼 있어야 한다.** 평문 제목·본문·태그·폴더명이 네트워크 계층에 닿으면 버그다.
3. root key(비밀번호에서 유도한 키)는 PC에서는 메모리에만 둔다. 디스크·localStorage·IndexedDB에 쓰지 않는다. 모바일(Tauri/Capacitor)에서만 OS 키체인에 저장하고 생체인증으로 꺼낸다.
   - 패스키 잠금 해제(WebAuthn PRF, 2026-11 사용자 승인): 인증기가 매번 만들어 주는 비밀값으로 itemsKey를 한 번 더 **감싸** 이 기기 meta(`deviceUnlock`)에 둔다. 비밀값과 거기서 만든 키는 저장하지 않는다. 디스크에 있는 것은 감싼 열쇠뿐이고 서버로 가지 않는다. `VaultSession.enableDeviceUnlock` / `unlockWithDeviceSecret`.
   - 같은 방식으로 이 기기 전용 작은 값(자동 백업 비밀번호)은 `sealLocal`로 itemsKey에 잠가 둔다. 평문으로 저장하지 않는다.
4. 동기화 백엔드는 `SyncBackend` 인터페이스(`packages/core/src/sync/SyncBackend.ts`)로만 접근한다. Google Drive가 기본, Supabase는 Pro 옵션. UI는 어느 백엔드인지 몰라야 한다.
5. 삭제는 tombstone(`deletedAt`)이다. 물리 삭제는 "계정 삭제" 흐름에서만.
6. 충돌은 LWW(`updatedAt` 큰 쪽 채택) + 진 쪽을 "충돌 사본" 메모로 보존한다. 데이터를 조용히 버리지 않는다.
7. 백업 파일은 **age 포맷**(`age-encryption` 패키지, 패스프레이즈 모드)이다. 자체 포맷을 만들지 않는다. `age -d`로 풀리는지가 테스트 기준.
8. 런타임 의존성은 최소로: `libsodium-wrappers-sumo`, `age-encryption`, `dexie`, `@supabase/supabase-js`(Pro 모듈에서만), React. 새 런타임 의존성은 이유를 적고 추가한다.
   - `@zxcvbn-ts/*`(apps/web): 약한 비밀번호가 위협 모델의 가장 큰 약점이라 추가. 비밀번호를 정하는 화면에서만 지연 로딩, 계산은 기기 안.
   - `@fontsource/*`(빌드 자산): 외부 글꼴 서버 요청을 없애려고 글꼴을 번들에 넣음.
9. 테스트 먼저. `packages/core`는 UI 없이 Vitest로 100% 돌아가야 한다. 암호화 라운드트립, 동기화 충돌, 백업 복구는 필수 테스트.
10. 한국어 UI 문구는 `apps/web/src/i18n/ko.ts` 한 곳에 둔다.

## 모노레포 구조
```
packages/core      암호화 · 로컬 저장 · 동기화 엔진 · 백업 (UI 없음, 브라우저/Node 공용)
apps/web           React + Vite PWA (PC와 모바일 브라우저)
apps/desktop       Tauri 2 래퍼 (2단계) — apps/web을 그대로 감쌈
apps/mobile        Tauri 2 Android/iOS (3단계)
supabase/          Pro 백엔드: 마이그레이션, RLS, Edge Function(backup-mail)
docs/              스펙 · 데이터 모델 · 아키텍처 · 로드맵
```

## 명령
- `pnpm i` / `pnpm -r test` / `pnpm --filter core test --watch`
- `pnpm --filter web dev` (localhost:5173)
- `pnpm --filter @vault/web e2e` (Playwright, 설치된 Chrome 사용. 화면 흐름 12개: 패스키는 가상 인증기, 자동 백업은 가상 폴더, 두 기기 동기화는 가짜 Drive)
- `node apps/web/scripts/shots.mjs <폴더> [light|dark]` (디자인 검토용 화면 캡처, 개발 서버 필요)
- `supabase start` / `supabase db reset` (Pro 모듈 작업 시)

## 작업 순서 (새 기능)
1. `docs/SPEC.md`에서 해당 항목 확인, 없으면 먼저 스펙에 한 줄 추가
2. `packages/core`에 테스트 작성 → 구현 → `pnpm -r test`
3. UI 연결 (`apps/web`)
4. `docs/ROADMAP.md`의 체크박스 갱신

## 하지 않는 것
- 서버 측 검색, 공유 링크, 실시간 공동편집, 서버 AI 요약 — 제로-널리지와 충돌. 요청이 와도 구현하지 말고 이유를 설명한다.
- Supabase Vault / pgsodium 컬럼 암호화 — 서버가 복호화할 수 있어 무의미.
