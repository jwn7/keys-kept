# crypto/ — 구현 가이드

전부 `libsodium-wrappers-sumo`. `await sodium.ready` 후에만 호출.

## kdf.ts
```ts
export async function deriveKey(password: string, params: KdfParams): Promise<Uint8Array> // 32B
// sodium.crypto_pwhash(32, password, salt, params.opslimit, params.memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13)
export function newKdfParams(profile: 'desktop' | 'mobile'): KdfParams
// desktop: opslimit 3, memlimit 256MB / mobile: opslimit 3, memlimit 64MB. salt = randombytes(16)
```
결정성 테스트: 같은 password+params → 같은 키. 다른 salt → 다른 키.

## aead.ts
```ts
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array }
// nonce = randombytes(24); crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key)
export function open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array
// 실패 시 throw DecryptError (키 틀림 또는 변조)
```
테스트: 라운드트립, 1바이트 변조 → throw, AAD 변경 → throw, 같은 평문 두 번 → 다른 암호문.

## keys.ts
```ts
export function newItemsKey(): Uint8Array            // randombytes(32)
export function wrap(rootKey, itemsKey): string      // seal 후 nonce||ciphertext base64
export function unwrap(rootKey, wrapped: string): Uint8Array
export function newRecoveryPhrase(): string[]        // BIP39 영단어 12개 (bip39 패키지 or 자체 2048 단어표)
export function recoveryKey(phrase: string[], params: KdfParams): Promise<Uint8Array>
```

## item.ts (model ↔ crypto 연결)
```ts
export function encryptNote(itemsKey, itemsKeyId, note: Note, deviceId): EncryptedItem
export function decryptNote(itemsKey, item: EncryptedItem): Note
```
AAD = `JSON.stringify({v:1,id,type})` 바이트. `decryptNote`는 `item.aad.id === item.id` 확인 후 open.

## 로그 금지
이 폴더 안에서 `console.*` 사용 금지(ESLint). 키·평문이 로그에 남는 사고가 가장 흔한 실수다.

## 구현 메모 (1단계 완료)
- `encryptNote(..., deviceId, version = 1)` — 다섯 번째 선택 인자. 버전 번호는 `VaultSession.save`가 "이전 + 1"로 넘긴다.
- `wrap/unwrap`의 AAD는 고정 문자열 `vault:itemsKey:v1` (용도 꼬리표).
- `recoveryKey`: NFKD·trim·소문자 정규화 → BIP39 체크섬 검사(`InvalidRecoveryPhraseError`) → 정규화 문구를 Argon2id 비밀번호로.
- BIP39 단어표·체크섬은 `@scure/bip39` 사용.
