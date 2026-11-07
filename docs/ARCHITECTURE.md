# 아키텍처

## 층

```
┌─────────────────────────────────────────────────────┐
│ apps/web (React PWA)  ·  apps/desktop (Tauri)  ·  apps/mobile (Tauri) │
│   화면 · 상태(Zustand) · i18n · 서비스워커               │
├─────────────────────────────────────────────────────┤
│ packages/core                                       │
│   crypto/   kdf(Argon2id) · aead(XChaCha20) · keys  │
│   store/    LocalStore(Dexie) · NoteIndex(검색·백링크) │
│   sync/     SyncEngine · SyncBackend · drive · supabase · memory │
│   backup/   ageExport · ageImport · obsidianExport  │
│   model/    Note · EncryptedItem · ItemsKeyRecord   │
├─────────────────────────────────────────────────────┤
│ 플랫폼 어댑터 (platform/)                              │
│   KeyStorage: 메모리(PC) / 키체인+생체(모바일)           │
│   Share: 다운로드(PC) / OS 공유 시트(모바일)              │
│   Network: fetch / Tauri http                        │
└─────────────────────────────────────────────────────┘
```

`packages/core`는 DOM·React를 모른다. Node(Vitest)와 브라우저에서 같은 코드가 돈다.

## 핵심 흐름

### 잠금 해제
```
password ─▶ kdf.deriveRootKey(password, kdf) ─▶ rootKey
rootKey + meta.wrappedItemsKey ─▶ keys.unwrap ─▶ itemsKey
blobs.getAll() ─▶ aead.open(itemsKey, each) ─▶ Note[] ─▶ NoteIndex.build ─▶ UI
```
PC: rootKey·itemsKey는 `KeyStorage.memory`. 모바일: 첫 해제 후 `KeyStorage.keychain.save(rootKey)` → 다음부터 생체인증으로 `load`.

### 저장
```
UI 편집 ─(1s debounce)─▶ store.save(note)
  ├─ note.updatedAt = now, version++
  ├─ aead.seal(itemsKey, note) ─▶ EncryptedItem ─▶ blobs.put
  ├─ versions.push (20개 유지)
  └─ outbox.put({id, op:'put'})
SyncEngine.flush() (온라인이면 즉시, 아니면 복귀 시)
```

### 동기화 (SyncEngine.sync)
```
1. pull: backend.list(since=meta.lastSyncAt) ─▶ 각 item:
     local 없음 ─▶ 저장
     local.version 분기 ─▶ LWW + 충돌 사본 생성
     remote.deletedAt ─▶ 로컬 tombstone
2. push: outbox 순서대로 backend.put / delete, 성공 시 outbox 제거
3. meta.lastSyncAt = max(remote.updatedAt)
4. 이벤트: 'synced' | 'offline' | 'conflict' | 'error' ─▶ UI 상태 뱃지
```
트리거: 앱 시작, 포커스 복귀, 30초 간격(Drive), Realtime 이벤트(Supabase), outbox에 항목 생김.

### 백업
```
Note[] ─▶ JSON ─▶ age.Encrypter(passphrase).encrypt ─▶ Uint8Array
  무료: Share.save('vault-YYYY-MM-DD.age')
  Pro : POST /functions/v1/backup-mail (multipart) ─▶ Resend 첨부 발송
```

## 모듈 경계 규칙
- `crypto/`는 `Uint8Array`만 받고 돌려준다. JSON·base64 변환은 `model/codec.ts`.
- `sync/SyncEngine`은 `SyncBackend`와 `LocalStore`만 안다. Drive 토큰·Supabase 세션은 각 백엔드 내부.
- UI는 `core`의 `VaultSession` 하나만 잡는다: `unlock() / lock() / notes$ / save() / sync() / backup()`.

## 플랫폼별 메모
| | PWA | Tauri 데스크톱 | Tauri 모바일 |
|---|---|---|---|
| 로컬 DB | IndexedDB(Dexie) | 같은 IndexedDB (WebView) 또는 `tauri-plugin-sql` SQLite | 같음 |
| 키 저장 | 메모리 | 메모리 | `tauri-plugin-stronghold` 또는 `tauri-plugin-biometric` + keystore |
| Google 로그인 | OAuth PKCE (팝업/리다이렉트) | 시스템 브라우저 + 딥링크 | 같음 |
| 공유 | 다운로드 | 파일 저장 대화상자 | `tauri-plugin-share` |
| SMTP (선택) | 불가 | Rust `lettre` 가능 | 가능 |

## 테스트 전략
- `crypto`: 라운드트립, 잘못된 키 실패, AAD 변조 감지, KDF 결정성(같은 입력 = 같은 키).
- `sync`: `MemoryBackend`로 두 "기기" 시뮬레이션 — 동시 수정 충돌, 오프라인 큐, tombstone 전파, 증분 since.
- `backup`: 내보내기 → `age` CLI로 복호화(CI에 age 설치) → 가져오기 병합.
- `store`: 1,000개 저장/로드 1초 내 (벤치, CI에서는 경고만).
- UI: Playwright로 잠금→작성→잠금→해제 플로우 1개.
