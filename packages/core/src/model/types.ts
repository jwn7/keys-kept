/** docs/DATA-MODEL.md 와 1:1. 바꾸면 문서도 같이 바꾼다. */

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  folder: string | null;
  pinned: boolean;
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
