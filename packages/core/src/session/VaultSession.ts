import { ready, sodium } from '../crypto/sodium';
import { deriveKey, newKdfParams } from '../crypto/kdf';
import { newItemsKey, newRecoveryPhrase, recoveryKey, unwrap, wrap } from '../crypto/keys';
import { decryptNote, encryptNote } from '../crypto/item';
import { DecryptError } from '../crypto/errors';
import type { LocalStore } from '../store/LocalStore';
import type { SyncBackend } from '../sync/SyncBackend';
import type { ItemsKeyRecord, KdfParams, Note } from '../model/types';

export class LockedError extends Error {
  constructor() {
    super('vault is locked');
    this.name = 'LockedError';
  }
}
export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password or recovery phrase');
    this.name = 'WrongPasswordError';
  }
}
export class NotSetUpError extends Error {
  constructor() {
    super('no items key record: run setup() first');
    this.name = 'NotSetUpError';
  }
}

export type VaultSessionOptions = {
  store: LocalStore;
  backend: SyncBackend;
  deviceId: string;
  /** 기본 'desktop'. 테스트는 kdfParams로 가벼운 파라미터를 주입한다. */
  kdfProfile?: 'desktop' | 'mobile';
  kdfParams?: () => KdfParams;
};

/** save()에 넘기는 입력. id 없으면 새 메모. */
export type NoteInput = Partial<Pick<Note, 'id' | 'title' | 'body' | 'tags' | 'folder' | 'pinned'>>;

/**
 * UI가 잡는 단 하나의 핸들 (ARCHITECTURE.md). 복호화된 Note와 키는 이 객체의 메모리에만 산다.
 * lock()이 전부 지운다. 디스크(LocalStore)에는 암호문만 간다.
 */
export class VaultSession {
  private readonly store: LocalStore;
  private readonly backend: SyncBackend;
  private readonly deviceId: string;
  private readonly makeKdfParams: () => KdfParams;

  private itemsKey: Uint8Array | null = null;
  private keyRecord: ItemsKeyRecord | null = null;
  private notes = new Map<string, Note>();
  private versions = new Map<string, number>();

  constructor(opts: VaultSessionOptions) {
    this.store = opts.store;
    this.backend = opts.backend;
    this.deviceId = opts.deviceId;
    this.makeKdfParams = opts.kdfParams ?? (() => newKdfParams(opts.kdfProfile ?? 'desktop'));
  }

  get isLocked(): boolean {
    return this.itemsKey === null;
  }

  // ---- 열쇠 ----

  /** 첫 실행: itemsKey 생성, 비밀번호·복구 문구로 각각 감싸 백엔드와 로컬 meta에 저장. 바로 잠금 해제 상태. */
  async setup(password: string): Promise<{ recoveryPhrase: string[] }> {
    await ready();
    const phrase = newRecoveryPhrase();
    const kdf = this.makeKdfParams();
    const kdfRecovery = this.makeKdfParams();
    const rootKey = await deriveKey(password, kdf);
    const rKey = await recoveryKey(phrase, kdfRecovery);
    const itemsKey = newItemsKey();
    try {
      const record: ItemsKeyRecord = {
        id: crypto.randomUUID(),
        wrappedKey: wrap(rootKey, itemsKey),
        wrappedKeyRecovery: wrap(rKey, itemsKey),
        kdf,
        kdfRecovery,
        protocol: 1,
        createdAt: new Date().toISOString(),
      };
      await this.backend.putKeys([record]);
      await this.store.setMeta('itemsKeyRecord', record);
      await this.store.setMeta('deviceId', this.deviceId);
      this.keyRecord = record;
      this.itemsKey = itemsKey;
      await this.loadNotes();
    } finally {
      sodium.memzero(rootKey);
      sodium.memzero(rKey);
    }
    return { recoveryPhrase: phrase };
  }

  async unlock(password: string): Promise<void> {
    await ready();
    const record = await this.loadKeyRecord();
    const rootKey = await deriveKey(password, record.kdf);
    try {
      await this.unlockWith(rootKey, record.wrappedKey, record);
    } finally {
      sodium.memzero(rootKey);
    }
  }

  async unlockWithRecovery(phrase: string[]): Promise<void> {
    await ready();
    const record = await this.loadKeyRecord();
    let rKey: Uint8Array;
    try {
      rKey = await recoveryKey(phrase, record.kdfRecovery);
    } catch {
      throw new WrongPasswordError();
    }
    try {
      await this.unlockWith(rKey, record.wrappedKeyRecovery, record);
    } finally {
      sodium.memzero(rKey);
    }
  }

  /** 비밀번호 변경 = wrappedKey만 재생성. 메모 재암호화 없음 (DATA-MODEL.md). */
  async changePassword(current: string, next: string): Promise<void> {
    const itemsKey = this.requireUnlocked();
    const record = await this.loadKeyRecord();
    const oldRoot = await deriveKey(current, record.kdf);
    try {
      unwrap(oldRoot, record.wrappedKey);
    } catch (e) {
      if (e instanceof DecryptError) throw new WrongPasswordError();
      throw e;
    } finally {
      sodium.memzero(oldRoot);
    }
    const kdf = this.makeKdfParams();
    const newRoot = await deriveKey(next, kdf);
    try {
      const updated: ItemsKeyRecord = { ...record, kdf, wrappedKey: wrap(newRoot, itemsKey) };
      await this.backend.putKeys([updated]);
      await this.store.setMeta('itemsKeyRecord', updated);
      this.keyRecord = updated;
    } finally {
      sodium.memzero(newRoot);
    }
  }

  /** 메모리의 키와 평문을 모두 지운다. 로컬 DB에는 암호문만 남는다. */
  lock(): void {
    if (this.itemsKey) sodium.memzero(this.itemsKey);
    this.itemsKey = null;
    this.keyRecord = null;
    this.notes.clear();
    this.versions.clear();
  }

  // ---- 메모 ----

  /** 삭제되지 않은 메모. 핀 먼저, 그다음 updatedAt 내림차순. */
  list(): Note[] {
    this.requireUnlocked();
    return [...this.notes.values()]
      .filter((n) => n.deletedAt === null)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  get(id: string): Note | undefined {
    this.requireUnlocked();
    const n = this.notes.get(id);
    return n && n.deletedAt === null ? n : undefined;
  }

  /** 새 메모 또는 수정. updatedAt = now, version = 이전 + 1. 암호화 → blobs, versions, outbox. */
  async save(input: NoteInput): Promise<Note> {
    this.requireUnlocked();
    const now = new Date().toISOString();
    const prev = input.id ? this.notes.get(input.id) : undefined;
    const body = input.body ?? prev?.body ?? '';
    const note: Note = {
      id: prev?.id ?? input.id ?? crypto.randomUUID(),
      title: input.title ?? prev?.title ?? '',
      body,
      tags: input.tags ?? extractTags(body),
      folder: input.folder ?? prev?.folder ?? null,
      pinned: input.pinned ?? prev?.pinned ?? false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.persist(note, 'put');
    return note;
  }

  /** tombstone: deletedAt 설정 후 저장. 물리 삭제는 계정 삭제 흐름에서만. */
  async delete(id: string): Promise<void> {
    this.requireUnlocked();
    const prev = this.notes.get(id);
    if (!prev || prev.deletedAt !== null) return;
    const now = new Date().toISOString();
    await this.persist({ ...prev, updatedAt: now, deletedAt: now }, 'delete');
  }

  // ---- 내부 ----

  private requireUnlocked(): Uint8Array {
    if (!this.itemsKey) throw new LockedError();
    return this.itemsKey;
  }

  /** 로컬 meta → 없으면 백엔드(새 기기) → 로컬에 복사. */
  private async loadKeyRecord(): Promise<ItemsKeyRecord> {
    if (this.keyRecord) return this.keyRecord;
    const local = await this.store.getMeta('itemsKeyRecord');
    if (local) return local;
    const remote = (await this.backend.getKeys()).find((k) => k.protocol === 1);
    if (!remote) throw new NotSetUpError();
    await this.store.setMeta('itemsKeyRecord', remote);
    return remote;
  }

  private async unlockWith(wrappingKey: Uint8Array, wrapped: string, record: ItemsKeyRecord): Promise<void> {
    let itemsKey: Uint8Array;
    try {
      itemsKey = unwrap(wrappingKey, wrapped);
    } catch (e) {
      if (e instanceof DecryptError) throw new WrongPasswordError();
      throw e;
    }
    this.itemsKey = itemsKey;
    this.keyRecord = record;
    await this.loadNotes();
  }

  private async loadNotes(): Promise<void> {
    const itemsKey = this.requireUnlocked();
    this.notes.clear();
    this.versions.clear();
    for (const item of await this.store.allBlobs()) {
      this.notes.set(item.id, decryptNote(itemsKey, item));
      this.versions.set(item.id, item.version);
    }
  }

  private async persist(note: Note, op: 'put' | 'delete'): Promise<void> {
    const itemsKey = this.requireUnlocked();
    const record = this.keyRecord;
    if (!record) throw new NotSetUpError();
    const version = (this.versions.get(note.id) ?? 0) + 1;
    const item = encryptNote(itemsKey, record.id, note, this.deviceId, version);
    await this.store.putBlob(item);
    await this.store.pushVersion(item);
    await this.store.enqueue(note.id, op);
    this.notes.set(note.id, note);
    this.versions.set(note.id, version);
  }
}

/** 본문의 `#태그` 자동 인식 (SPEC §2.1). 코드 블록 안은 3단계 편집기에서 제외 처리. */
export function extractTags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) out.add(m[2] ?? '');
  out.delete('');
  return [...out];
}
