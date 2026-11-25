# 고도화 방향 검토 (2026-11-25)

기준은 하나다. **평문이 기기 밖으로 나가는가.** 나가면 하지 않는다 (CLAUDE.md "하지 않는 것").

## 하지 않는 것: 외부 LLM API (무료 포함)
- Gemini 무료 티어, Groq, OpenRouter 무료 모델 등은 메모 평문을 그 회사 서버로 보내야 동작한다. "개발자도 못 보는 메모장"이 "AI 회사는 보는 메모장"이 된다.
- 무료 티어는 입력을 학습에 쓰거나 기록하는 곳이 있고, 정책이 제공사마다 다르며 자주 바뀐다.
- 사용자가 자기 API 키를 넣는 방식도 같은 이유로 넣지 않는다. 넣는다면 "이 메모가 암호화 없이 외부로 전송됩니다"를 매번 보여주는 별도 기능이어야 하고, 제품 약속과 충돌한다.

## 조건부로 가능: 기기 안에서 도는 AI
| 후보 | 상태 | 판단 |
|---|---|---|
| Chrome 내장 Summarizer API | Chrome·Edge 138부터 정식. 입력 언어 en/ja/es/de/fr | **한국어 미지원이라 보류.** 한국어가 추가되면 "이 기기에서 요약" 버튼으로 넣는다. 의존성 0, 평문이 기기를 떠나지 않음 |
| WebLLM / transformers.js | 모델 수백 MB~수 GB 다운로드, WebGPU 필요 | 보류. 모바일에서 무겁고 번들·저장 공간 부담이 큼 |

## 추천 순서
1. **패스키로 잠금 해제 (WebAuthn PRF)** — 지문·Windows Hello로 열기. 인증기가 매번 비밀값을 만들어 주고, 그 값으로 itemsKey를 한 번 더 감싸 둔다. 열쇠를 디스크에 두지 않으므로 규칙 3의 취지와 맞지만, **키 계층에 세 번째 감싼 열쇠가 생기는 설계 변경이라 사용자 승인 필요.** 지원: Chromium 계열 + 최신 Windows(2026-02 업데이트 이후) / Android·패스키 제공자에 따라 다름 / Safari 불확실. 안 되는 기기는 지금처럼 비밀번호.
2. **zxcvbn 비밀번호 강도** (SPEC v1.5 예정) — 약한 비밀번호는 위협 모델에 적힌 약점. 지연 로딩으로 번들 영향 최소화.
3. **Playwright E2E** — 잠금 해제 → 작성 → 잠금 → 다시 열기, 두 브라우저 컨텍스트로 Drive 없는 동기화 흐름.
4. **자동 로컬 백업** — File System Access API로 사용자가 고른 폴더에 주기적으로 `.age` 저장 (Chromium). 서버 없이 백업 습관을 만든다.
5. **검색 개선** — 메모가 수천 개를 넘으면 MiniSearch(기기 안 색인). 새 런타임 의존성이라 그때 추가.
6. **PWA 다듬기** — 앱 아이콘 길게 누르기 메뉴("새 메모"), 다른 앱에서 공유받기(Web Share Target).
7. **첨부파일** — 이미지 붙여넣기 → 청크 암호화. 데이터 모델에 `attachment` 타입이 예약돼 있다.

## 끝낸 것
- [x] 글꼴 자체 호스팅 — Google Fonts 요청 제거. 앱을 켤 때 외부로 나가는 요청이 0개 (Drive 연결 전).
- [x] 패스키 잠금 해제 (1번) — 코어 테스트 + Chrome 가상 인증기(PRF) E2E 통과. 실제 지문 센서 기기에서는 한 번 눌러 보면 된다.
- [x] zxcvbn 비밀번호 강도 (2번)
- [x] Playwright E2E 7개 (3번), CI에 e2e 작업 추가
- [x] 자동 로컬 백업 (4번) — 브라우저 안 가상 폴더(OPFS)로 E2E: age 파일이 써지고 비밀번호가 평문으로 남지 않는 것 확인.
- [x] 검색 개선 (5번) — 의존성 없이 여러 단어·순위. MiniSearch는 메모가 수천 개를 넘을 때.
- [x] 앱 아이콘 바로가기 (6번 일부)

## 남긴 것과 이유
- **다른 앱에서 공유받기(Web Share Target)**: GET 방식은 공유된 글이 주소에 실려 호스팅 서버 로그에 남는다(평문 유출). POST + 서비스 워커 직접 구현이 필요하다.
- **첨부파일**: 백업 파일 형식(v2), 크기 한도, 안 쓰는 첨부 정리, 옵시디언 내보내기까지 같이 정해야 한다. 한번 동기화되면 되돌리기 어려운 형식 결정이라 따로 설계한다.

## 참고
- Summarizer API: https://developer.chrome.com/docs/ai/summarizer-api
- WebAuthn PRF: https://www.corbado.com/blog/passkeys-prf-webauthn , https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/
- 무료 LLM API 비교: https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
