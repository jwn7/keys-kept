# 모바일 (Tauri 2 Android) — 5단계 메모

이 저장소의 `apps/web`은 390px에서 모바일 레이아웃으로 동작하는 PWA다 (v1). v1.5의 Tauri 2 Android 래핑은 Rust·Android SDK가 필요해 CI 밖에서 진행한다. 아래는 그때 따를 순서다.

## 준비
1. Rust (`rustup`), Android Studio + SDK/NDK, `JAVA_HOME`.
2. `pnpm add -g @tauri-apps/cli` → `cd apps/mobile && pnpm tauri android init`.
3. `apps/mobile/src-tauri/tauri.conf.json`의 `frontendDist`를 `../../web/dist`, `devUrl`을 `http://<LAN-IP>:5173`으로.

## 키 저장 (KeyStorage.keychain)
- `tauri-plugin-stronghold` 또는 `tauri-plugin-biometric` + Android Keystore.
- 흐름: 첫 해제는 비밀번호 → root key를 키체인에 저장 → 이후 생체인증으로 `load` (SPEC §1.2).
- 5회 실패 또는 새 기기면 키체인 항목을 지우고 비밀번호로.
- `packages/core`는 그대로 쓴다. 바뀌는 것은 `apps/web/src/app/session.ts`의 KeyStorage 어댑터뿐.

## Google 로그인
PWA의 GIS 토큰 클라이언트는 WebView에서 막힌다. 시스템 브라우저 + 딥링크(`vault://oauth`) PKCE로 바꾸고, `DriveAuth` 구현체만 교체한다 (`DriveBackend`는 그대로).

## 공유
`.age` 백업은 `tauri-plugin-share`로 OS 공유 시트. `shareOrDownload()`가 `navigator.share` 폴백을 이미 갖고 있다.

## Play 체크리스트 (SPEC §8)
- 개인정보처리방침: `docs/PRIVACY.md`를 공개 URL로.
- Data Safety: 암호화됨 · 전송 중 암호화 · 삭제 요청 가능.
- 앱 내 계정 삭제: 설정 > 내 데이터 > 삭제 (구현됨). 웹 삭제 요청 URL은 PRIVACY.md에 채운다.
- OAuth 동의 화면: `drive.file` (non-sensitive), 앱 이름·로고·개인정보 URL.
