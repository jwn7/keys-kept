/** docs/DATA-MODEL.md 와 1:1. 바꾸면 문서도 같이 바꾼다. */

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  folder: string | null;
  pinned: boolean;
  /** 일정 날짜 `YYYY-MM-DD` (캘린더 보기). 암호문 안에 있다. 이전 버전 메모에는 없을 수 있다. */
  date?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ItemType = 'note' | 'attachment' | 'settings';

export type EncryptedItem = {
  id: string;
  type: ItemType;
  itemsKeyId: string;
  nonce: string;        // base64, 24 bytes
  ciphertext: string;   // base64
  aad: { v: 1; id: string; type: ItemType };
  version: number;
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string;
};

export type KdfParams = {
  alg: 'argon2id';
  salt: string;         // base64, 16 bytes
  opslimit: number;     // libsodium crypto_pwhash_OPSLIMIT_MODERATE = 3
  memlimit: number;     // libsodium crypto_pwhash_MEMLIMIT_MODERATE = 256MB → 모바일은 64MB로 낮춤
};

export type ItemsKeyRecord = {
  id: string;
  wrappedKey: string;
  wrappedKeyRecovery: string;
  kdf: KdfParams;
  kdfRecovery: KdfParams;
  protocol: 1;
  createdAt: string;
};

export type SyncStatus =
  | { state: 'synced'; at: string }
  | { state: 'offline'; pending: number }
  /** 동기화 저장소 로그인이 만료됨. 사용자가 다시 연결해야 한다 (자동으로 로그인 창을 띄우지 않는다). */
  | { state: 'auth'; pending: number }
  | { state: 'syncing' }
  | { state: 'conflict'; count: number }
  | { state: 'error'; message: string };

export type BackupFile = {
  format: 'vault-backup';
  version: 1;
  exportedAt: string;
  device: string;
  notes: Note[];
};
