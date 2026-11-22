# 데이터 모델

## 키 계층 (Standard Notes 004 방식)

```
비밀번호 ──Argon2id(salt)──▶ rootKey (32B, 기기 메모리/키체인)
                                 │ XChaCha20-Poly1305
                                 ▼
                        itemsKey (32B 랜덤) ──▶ wrappedItemsKey (백엔드에 저장)
                                 │ XChaCha20-Poly1305 (항목마다 새 nonce)
                                 ▼
                           Note JSON ──▶ ciphertext (백엔드에 저장)
복구키 12단어 ──Argon2id──▶ recoveryKey ──▶ wrappedItemsKey_recovery (백엔드에 저장)
```

- 비밀번호 변경 = `wrappedItemsKey`만 다시 생성. 메모 재암호화 없음.
- `itemsKey`는 프로토콜 버전당 1개. 향후 버전 업 시 새 itemsKey로 점진 재암호화.
- AAD(추가 인증 데이터)에 `{v: 1, id, type}`을 넣어 암호문 바꿔치기를 막는다.

## 로컬 (기기) — IndexedDB via Dexie, Tauri는 SQLite

| 스토어 | 키 | 내용 | 비고 |
|---|---|---|---|
| `blobs` | `id` | 암호문 레코드 (아래 `EncryptedItem`) | 잠금 중에도 유지 |
| `outbox` | `id` | 업로드 대기 `id` + `op`(put/delete) + `queuedAt` | 온라인 시 순서대로 플러시 |
| `versions` | `++seq` (색인 `noteId`) | 과거 암호문 (최근 20개) + `savedAt`, `windowStart` | 로컬 전용. 자동 저장은 `windowStart`부터 5분 동안 같은 칸을 덮어쓴다 |
| `meta` | `key` | `lastSyncAt`, `deviceId`, `deviceName`, `backend`, `kdfParams`, `wrappedItemsKey` | |

복호화된 메모(`Note`)는 **메모리에만** (Zustand 스토어). 잠금 시 비움.

## 타입

```ts
// 복호화된 상태 — 기기 메모리에만 존재
export type Note = {
  id: string;            // uuid v4, 기기에서 생성
  title: string;
  body: string;          // markdown
  tags: string[];        // 본문 #태그 + 수동
  folder: string | null;
  pinned: boolean;
  date?: string | null;  // 일정 날짜 YYYY-MM-DD (캘린더 보기). 암호문 안. 이전 메모에는 없음 = null
  createdAt: string;     // ISO
  updatedAt: string;     // ISO, 충돌 판정 기준
  deletedAt: string | null;
};

// 백엔드·로컬 blobs에 저장되는 상태
export type EncryptedItem = {
  id: string;
  type: 'note';          // 향후 'attachment' | 'settings'
  itemsKeyId: string;
  nonce: string;         // base64, 24B
  ciphertext: string;    // base64, Note JSON을 XChaCha20-Poly1305로
  aad: { v: 1; id: string; type: 'note' };
  version: number;       // 기기에서 증가. 분기 감지용
  updatedAt: string;     // 평문 (정렬·증분 동기화에 필요)
  deletedAt: string | null;
  deviceId: string;      // 마지막 수정 기기
};

// 동기화 상태: synced | syncing | offline(pending) | auth(pending, 다시 로그인 필요) | conflict | error

export type ItemsKeyRecord = {
  id: string;
  wrappedKey: string;        // base64, rootKey로 감싼 itemsKey
  wrappedKeyRecovery: string;// base64, recoveryKey로 감싼 itemsKey
  kdf: { alg: 'argon2id'; salt: string; opslimit: number; memlimit: number };
  kdfRecovery: { alg: 'argon2id'; salt: string; opslimit: number; memlimit: number };
  protocol: 1;
  createdAt: string;
};
```

서버가 아는 것: `id, type, updatedAt, deletedAt, version, deviceId, 크기`.
서버가 모르는 것: 제목, 본문, 태그, 폴더, 핀 — 전부 `ciphertext` 안.

## 백엔드 A — Google Drive (기본)

```
Vault/                      ← 사용자가 고른 폴더 (drive.file 스코프)
  vault.json                ← { protocol: 1, itemsKeys: ItemsKeyRecord[], devices: [...] }
  notes/<id>.enc            ← EncryptedItem JSON 1개
```
- 증분: `files.list(q="'<notesFolderId>' in parents and modifiedTime > '<lastSyncAt>'")`
- 삭제: 파일을 지우지 않고 `deletedAt`이 있는 `.enc`로 덮어쓴다 (tombstone). 30일 후 파일 삭제.
- 충돌: Drive는 last-writer-wins 파일 시스템이므로, 업로드 전 `get`으로 `version` 비교 → 분기면 충돌 사본 생성 후 업로드.

## 백엔드 B — Supabase (Pro)

```sql
-- supabase/migrations/0001_init.sql 참고
items(id uuid pk, user_id uuid, type text, items_key_id uuid, nonce bytea, ciphertext bytea,
      aad jsonb, version int, updated_at timestamptz, deleted_at timestamptz, device_id uuid)
items_keys(id uuid pk, user_id uuid, wrapped_key bytea, wrapped_key_recovery bytea,
      kdf jsonb, kdf_recovery jsonb, protocol int, created_at timestamptz)
devices(id uuid pk, user_id uuid, name text, platform text, last_sync_at timestamptz)
```
- RLS: 세 테이블 모두 `user_id = auth.uid()` (select/insert/update/delete).
- 증분: `select * from items where updated_at > $lastSyncAt order by updated_at`.
- Realtime: `items` 테이블 `postgres_changes` 구독, `user_id=eq.<uid>` 필터.
- 첨부(v2): Storage 버킷 `attachments/<user_id>/<id>.enc`, 청크 1MB 단위 암호화.

## 백업 포맷 (age 안의 평문 JSON)

```json
{
  "format": "vault-backup",
  "version": 1,
  "exportedAt": "2026-11-09T03:00:00Z",
  "device": "jwn7-pc",
  "notes": [ /* Note[] — 삭제된 것 제외 */ ]
}
```
- 파일명 `vault-YYYY-MM-DD.age`. age 패스프레이즈 모드(scrypt). 복구 시 `format`과 `version` 검사.
- 테스트: 내보낸 파일을 실제 `age` CLI(`age -d`)로 풀어 JSON 파싱되는지 CI에서 확인.

## 옵시디언 내보내기 (평문)

```
vault-export-YYYY-MM-DD.zip
  업무/Supabase RLS 정책 메모.md     ← frontmatter: tags, created, updated
  개인/장보기.md
```
- `[[링크]]`와 `#태그`는 그대로 두면 옵시디언에서 작동한다.
- 제목의 파일명 금지 문자(`/ \ : * ? " < > |`)는 `_`로.
