# Vault 개인정보처리방침 (초안)

최종 수정: 2026-11-07

## 한 줄 요약
Vault는 메모를 **사용자 기기에서 암호화**합니다. 개발자, Google, Supabase 어디에서도 메모 제목·본문·태그·폴더를 읽을 수 없습니다.

## 수집하는 정보
| 항목 | 어디에 | 왜 |
|---|---|---|
| Google 계정 이메일 | 사용자의 Google Drive 연결 시 기기에 표시용으로만 저장 (서버 없음) | 어떤 계정이 연결됐는지 보여주기 위해 |
| 암호문 (XChaCha20-Poly1305) | 사용자 본인의 Google Drive `Vault/` 폴더 (무료) 또는 Supabase `items` 테이블 (Pro) | PC·폰 동기화 |
| 메타데이터: 메모 id, 수정 시각, 삭제 시각, 버전 번호, 기기 id, 암호문 크기 | 동기화 백엔드 | 증분 동기화·충돌 판정 |
| 감싼 데이터 키 + Argon2id 파라미터(salt, 비용) | 동기화 백엔드 | 새 기기에서 비밀번호로 열기 |
| Pro: Supabase Auth 계정(이메일), 백업 메일 주소 | Supabase | 로그인·백업 메일 발송 |

**수집하지 않는 것**: 마스터 비밀번호, 복구 키, 복호화된 메모, 검색어, 사용 통계.

## 암호화
- 비밀번호 → Argon2id → root key. 기기 메모리에만 (모바일은 OS 키체인, 생체인증으로 꺼냄).
- 메모는 XChaCha20-Poly1305로 기기에서 암호화. 네트워크에는 암호문만 갑니다.
- 백업은 표준 age 포맷(패스프레이즈 모드). `age -d`로 풀립니다.

## 제3자
- Google Drive API (`drive.file` 스코프): 앱이 만든 `Vault/` 폴더만 접근. Google의 정책: https://developers.google.com/terms/api-services-user-data-policy
- Supabase (Pro): 암호문·메타데이터 저장, Google 로그인 처리.
- Resend (Pro): 백업 메일 발송. age 암호문 첨부만 전달.

## 보관과 삭제
- 삭제한 메모는 30일간 휴지통(기기·백엔드에 암호문), 이후 내용은 비우고 삭제 표식만 남습니다.
- **계정과 모든 데이터 삭제**: 앱 설정 > 내 데이터 > 삭제. Drive `Vault/` 폴더, Supabase 행(cascade), 기기 로컬 DB가 모두 지워집니다. 웹 삭제 요청: [YOUR DELETE REQUEST URL].

## 못 막는 것 (위협 모델)
잠금 해제된 기기의 악성코드, 약한 비밀번호, 메타데이터(메모 수·크기·수정 시각), 사용자가 평문으로 내보낸 파일.

## 연락처
[YOUR CONTACT EMAIL]
