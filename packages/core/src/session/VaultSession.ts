import { ready, sodium } from '../crypto/sodium';
import { deriveKey, newKdfParams } from '../crypto/kdf';
import { newItemsKey, newRecoveryPhrase, recoveryKey, unwrap, wrap } from '../crypto/keys';
import { decryptNote, encryptNote } from '../crypto/item';
import { DecryptError } from '../crypto/errors';
import type { LocalStore } from '../store/LocalStore';
import type { SyncBackend } from '../sync/SyncBackend';
import { SyncEngine, type SyncResult } from '../sync/SyncEngine';
import type { EncryptedItem, ItemsKeyRecord, KdfParams, Note, SyncStatus } from '../model/types';

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
  /** 충돌 사본 제목과 설정 화면에 쓰는 사람이 읽는 이름 */
  deviceName?: string;
  /** 기본 'desktop'. 테스트는 kdfParams로 가벼운 파라미터를 주입한다. */
  kdfProfile?: 'desktop' | 'mobile';
  kdfParams?: () => KdfParams;
  isOnline?: () => boolean;
};

/** save()에 넘기는 입력. id 없으면 새 메모. */
export type NoteInput = Partial<Pick<Note, 'id' | 'title' | 'body' | 'tags' | 'folder' | 'pinned'>>;

export type SessionEvent =
  | { type: 'status'; status: SyncStatus }
  | { type: 'notes' } // 메모 목록이 바뀜 (저장·삭제·동기화·잠금)
  | { type: 'lock'; locked: boolean };

const CONFLICT_MARK = ' (충돌 사본 — ';

/** 충돌에서 진 쪽을 보존한 메모인지 (목록에 빨간 표시). */
export function isConflictCopy(note: Pick<Note, 'title'>): boolean {
  return note.title.includes(CONFLICT_MARK);
}

/**
 * UI가 잡는 단 하나의 핸들 (ARCHITECTURE.md). 복호화된 Note와 키는 이 객체의 메모리에만 산다.
 * lock()이 전부 지운다. 디스크(LocalStore)에는 암호문만 간다.
 */
export class VaultSession {
  private readonly store: LocalStore;
  private readonly backend: SyncBackend;
  private readonly deviceId: string;
  private readonly deviceName: string;
  private readonly makeKdfParams: () => KdfParams;
  private readonly engine: SyncEngine;

  private itemsKey: Uint8Array | null = null;
  private keyRecord: ItemsKeyRecord | null = null;
  private notes = new Map<string, Note>();
  private versions = new Map<string, number>();
  private listeners = new Set<(e: SessionEvent) => void>();

  constructor(opts: VaultSessionOptions) {
    this.store = opts.store;
    this.backend = opts.backend;
    this.deviceId = opts.deviceId;
    this.deviceName = opts.deviceName ?? opts.deviceId;
    this.makeKdfParams = opts.kdfParams ?? (() => newKdfParams(opts.kdfProfile ?? 'desktop'));
    this.engine = new SyncEngine({
      store: opts.store,
      backend: opts.backend,
      deviceId: opts.deviceId,
      onConflict: (loser, winner) => this.makeConflictCopy(loser, winner),
      ...(opts.isOnline ? { isOnline: opts.isOnline } : {}),
    });
    this.engine.on((e) => {
      if (e.type === 'status') this.emit({ type: 'status', status: e.status });
      // 'changed'는 sync()에서 결과를 받은 뒤 동기적으로 적용한다 (이벤트로 하면 경쟁 상태).
    });
  }

  get isLocked(): boolean {
    return this.itemsKey === null;
  }
  get status(): SyncStatus {
    return this.engine.status;
  }
  get backendKind(): SyncBackend['kind'] {
    return this.backend.kind;
  }

  subscribe(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
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
      await this.store.setMeta('deviceName', this.deviceName);
      this.keyRecord = record;
      this.itemsKey = itemsKey;
      await this.loadNotes();
      this.emit({ type: 'lock', locked: false });
    } finally {
      sodium.memzero(rootKey);
      sodium.memzero(rKey);
    }
    return { recoveryPhrase: phrase };
  }

  /** 잠긴 상태에서도 알 수 있는 것(평문 아님): 암호문 개수, 마지막 동기화 시각. 잠금 화면 안내용. */
  async lockedStats(): Promise<{ blobs: number; lastSyncAt: string | null }> {
    const blobs = (await this.store.allBlobs()).filter((b) => b.deletedAt === null).length;
    return { blobs, lastSyncAt: (await this.store.getMeta('lastSyncAt')) ?? null };
  }

  /** 로컬 meta에 키 레코드가 있는지 (첫 실행 화면 vs 잠금 해제 화면 분기). */
  async hasLocalKeys(): Promise<boolean> {
    return (await this.store.getMeta('itemsKeyRecord')) !== undefined;
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
    await this.rewrap(record, itemsKey, next);
  }

  /** 복구 문구로 비밀번호 재설정 (잠긴 상태에서). 성공하면 잠금 해제 상태. */
  async resetPasswordWithRecovery(phrase: string[], next: string): Promise<void> {
    await this.unlockWithRecovery(phrase);
    const itemsKey = this.requireUnlocked();
    await this.rewrap(await this.loadKeyRecord(), itemsKey, next);
  }

  /** 비밀번호 재확인 후 복구 문구를 다시 보여줄 수는 없다(저장하지 않음). 대신 새 문구를 발급한다. */
  async rotateRecoveryPhrase(password: string): Promise<string[]> {
    const itemsKey = this.requireUnlocked();
    const record = await this.loadKeyRecord();
    const root = await deriveKey(password, record.kdf);
    try {
      unwrap(root, record.wrappedKey);
    } catch (e) {
      if (e instanceof DecryptError) throw new WrongPasswordError();
      throw e;
    } finally {
      sodium.memzero(root);
    }
    const phrase = newRecoveryPhrase();
    const kdfRecovery = this.makeKdfParams();
    const rKey = await recoveryKey(phrase, kdfRecovery);
    try {
      const updated: ItemsKeyRecord = { ...record, kdfRecovery, wrappedKeyRecovery: wrap(rKey, itemsKey) };
      await this.saveKeyRecord(updated);
    } finally {
      sodium.memzero(rKey);
    }
    return phrase;
  }

  /** 메모리의 키와 평문을 모두 지운다. 로컬 DB에는 암호문만 남는다. */
  lock(): void {
    if (this.itemsKey) sodium.memzero(this.itemsKey);
    this.itemsKey = null;
    this.keyRecord = null;
    this.notes.clear();
    this.versions.clear();
    this.emit({ type: 'lock', locked: true });
  }

  // ---- 메모 ----

  /** 삭제되지 않은 메모. 핀 먼저, 그다음 updatedAt 내림차순. */
  list(): Note[] {
    this.requireUnlocked();
    return [...this.notes.values()]
      .filter((n) => n.deletedAt === null)
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0),
      );
  }

  /** 휴지통 (tombstone이지만 아직 내용이 남아 있는 것). */
  listDeleted(): Note[] {
    this.requireUnlocked();
    return [...this.notes.values()].filter((n) => n.deletedAt !== null && (n.body !== '' || n.title !== ''));
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
      folder: input.folder !== undefined ? input.folder : (prev?.folder ?? null),
      pinned: input.pinned ?? prev?.pinned ?? false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.persist(note, 'put');
    this.emit({ type: 'notes' });
    return note;
  }

  /** tombstone: deletedAt 설정 후 저장. 물리 삭제는 계정 삭제 흐름에서만. */
  async delete(id: string): Promise<void> {
    this.requireUnlocked();
    const prev = this.notes.get(id);
    if (!prev || prev.deletedAt !== null) return;
    const now = new Date().toISOString();
    await this.persist({ ...prev, updatedAt: now, deletedAt: now }, 'delete');
    this.emit({ type: 'notes' });
  }

  /** 휴지통에서 복원. */
  async restore(id: string): Promise<void> {
    this.requireUnlocked();
    const prev = this.notes.get(id);
    if (!prev || prev.deletedAt === null) return;
    await this.persist({ ...prev, updatedAt: new Date().toISOString(), deletedAt: null }, 'put');
    this.emit({ type: 'notes' });
  }

  /**
   * 백업 복구·마크다운 가져오기 병합 (SPEC §4): id 같으면 updatedAt 큰 쪽, 없으면 추가.
   * 로컬이 더 최신이면 건너뛴다(백업본은 versions에 남지 않지만 사용자가 가진 파일이므로 손실이 아니다).
   */
  async mergeNotes(incoming: Note[]): Promise<{ added: number; updated: number; skipped: number }> {
    this.requireUnlocked();
    const r = { added: 0, updated: 0, skipped: 0 };
    for (const n of incoming) {
      const local = this.notes.get(n.id);
      if (local && local.updatedAt >= n.updatedAt) {
        r.skipped++;
        continue;
      }
      await this.persist({ ...n, deletedAt: null, updatedAt: new Date().toISOString() }, 'put');
      if (local) r.updated++;
      else r.added++;
    }
    if (r.added + r.updated) this.emit({ type: 'notes' });
    return r;
  }

  /** 과거 버전(암호문)을 복호화해 돌려준다. 최신순. */
  async history(id: string): Promise<{ version: number; savedAt: string; note: Note }[]> {
    const itemsKey = this.requireUnlocked();
    const rows = await this.store.versions(id);
    return rows.map((r) => ({ version: r.version, savedAt: r.savedAt, note: decryptNote(itemsKey, r.item) }));
  }

  /** 과거 버전으로 되돌리기 = 그 내용으로 새 버전 저장 (SPEC §2.4). */
  async revert(id: string, version: number): Promise<Note> {
    const old = (await this.history(id)).find((h) => h.version === version);
    if (!old) throw new Error(`no version ${version} for ${id}`);
    return this.save({ id, title: old.note.title, body: old.note.body, tags: old.note.tags, folder: old.note.folder });
  }

  // ---- 동기화 ----

  async sync(): Promise<SyncResult> {
    const result = await this.engine.sync();
    if (result.changedIds.length) await this.applyChanged(result.changedIds);
    return result;
  }

  /** 백엔드 변경 알림(Realtime)이 있으면 연결한다. 없으면 no-op 해제 함수. */
  subscribeBackend(onChange: () => void): () => void {
    return this.backend.subscribe?.(onChange) ?? (() => undefined);
  }

  /** 계정 삭제: 원격 전부 + 로컬 전부. 되돌릴 수 없다. */
  async purgeEverything(): Promise<void> {
    await this.backend.purgeAll();
    await this.store.clear();
    this.lock();
  }

  // ---- 내부 ----

  private requireUnlocked(): Uint8Array {
    if (!this.itemsKey) throw new LockedError();
    return this.itemsKey;
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** 로컬 meta → 없으면 백엔드(새 기기) → 로컬에 복사. */
  private async loadKeyRecord(): Promise<ItemsKeyRecord> {
    if (this.keyRecord) return this.keyRecord;
    const local = await this.store.getMeta('itemsKeyRecord');
    if (local) return local;
    const remote = (await this.backend.getKeys()).find((k) => k.protocol === 1);
    if (!remote) throw new NotSetUpError();
    await this.store.setMeta('itemsKeyRecord', remote);
    await this.store.setMeta('deviceId', this.deviceId);
    await this.store.setMeta('deviceName', this.deviceName);
    return remote;
  }

  private async saveKeyRecord(updated: ItemsKeyRecord): Promise<void> {
    await this.backend.putKeys([updated]);
    await this.store.setMeta('itemsKeyRecord', updated);
    this.keyRecord = updated;
  }

  private async rewrap(record: ItemsKeyRecord, itemsKey: Uint8Array, password: string): Promise<void> {
    const kdf = this.makeKdfParams();
    const newRoot = await deriveKey(password, kdf);
    try {
      await this.saveKeyRecord({ ...record, kdf, wrappedKey: wrap(newRoot, itemsKey) });
    } finally {
      sodium.memzero(newRoot);
    }
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
    this.emit({ type: 'lock', locked: false });
  }

  private async loadNotes(): Promise<void> {
    const itemsKey = this.requireUnlocked();
    this.notes.clear();
    this.versions.clear();
    for (const item of await this.store.allBlobs()) {
      this.notes.set(item.id, decryptNote(itemsKey, item));
      this.versions.set(item.id, item.version);
    }
    this.emit({ type: 'notes' });
  }

  /** 동기화로 바뀐 blob만 다시 복호화. 잠겨 있으면 다음 unlock 때 loadNotes가 처리한다. */
  private async applyChanged(ids: string[]): Promise<void> {
    if (!this.itemsKey) return;
    for (const id of ids) {
      const item = await this.store.getBlob(id);
      if (!item) continue;
      this.notes.set(id, decryptNote(this.itemsKey, item));
      this.versions.set(id, item.version);
    }
    this.emit({ type: 'notes' });
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

  /** 충돌에서 진 쪽을 새 메모로. 잠겨 있으면 null (versions에는 엔진이 이미 보존했다). */
  private async makeConflictCopy(loser: EncryptedItem, _winner: EncryptedItem): Promise<EncryptedItem | null> {
    const itemsKey = this.itemsKey;
    const record = this.keyRecord;
    if (!itemsKey || !record) return null;
    let lost: Note;
    try {
      lost = decryptNote(itemsKey, loser);
    } catch {
      return null;
    }
    const who = loser.deviceId === this.deviceId ? this.deviceName : '다른 기기';
    const day = loser.updatedAt.slice(0, 10);
    const now = new Date().toISOString();
    const copy: Note = {
      ...lost,
      id: crypto.randomUUID(),
      title: `${lost.title}${CONFLICT_MARK}${who} ${day})`,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const item = encryptNote(itemsKey, record.id, copy, this.deviceId, 1);
    this.notes.set(copy.id, copy);
    this.versions.set(copy.id, 1);
    return item;
  }
}

/** 본문의 `#태그` 자동 인식 (SPEC §2.1). 코드 블록 안은 3단계 편집기에서 제외 처리. */
export function extractTags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) out.add(m[2] ?? '');
  out.delete('');
  return [...out];
}
