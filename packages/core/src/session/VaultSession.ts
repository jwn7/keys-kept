import { ready, sodium } from '../crypto/sodium';
import { deriveKey, newKdfParams } from '../crypto/kdf';
import { newItemsKey, newRecoveryPhrase, recoveryKey, unwrap, wrap } from '../crypto/keys';
import { decryptNote, encryptNote } from '../crypto/item';
import { DecryptError } from '../crypto/errors';
import { open, seal } from '../crypto/aead';
import { fromBase64, fromUtf8, toBase64, toUtf8 } from '../model/codec';
import type { LocalStore } from '../store/LocalStore';
import { OfflineError, type SyncBackend } from '../sync/SyncBackend';
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

/** 연결한 백엔드(Drive)에 이미 다른 볼트의 열쇠가 있다. 섞이지 않게 동기화를 멈춘다. */
export class VaultMismatchError extends Error {
  constructor() {
    super('이 동기화 저장소에는 다른 Vault가 있습니다');
    this.name = 'VaultMismatchError';
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
  /** 자동 저장을 한 버전 칸으로 묶는 구간(ms). 0이면 저장마다 새 버전 (기본, 테스트용). 앱은 5분을 준다 (SPEC §2.4). */
  versionWindowMs?: number;
};

/** save()에 넘기는 입력. id 없으면 새 메모. */
export type NoteInput = Partial<Pick<Note, 'id' | 'title' | 'body' | 'tags' | 'folder' | 'pinned'>> & { date?: string | null; secret?: Note['secret'] };

export type SessionEvent =
  | { type: 'status'; status: SyncStatus }
  | { type: 'notes' } // 메모 목록이 바뀜 (저장·삭제·동기화·잠금)
  | { type: 'lock'; locked: boolean }
  /** 서버가 옛 버전을 갖고 있던 메모를 이 기기의 최신본으로 되돌려 놓았다 (docs/SECURITY.md) */
  | { type: 'rollback'; count: number };

const CONFLICT_MARK = ' (충돌 사본 — ';
/** 기기 잠금 해제용 키를 뽑을 때 섞는 용도 문자열 (다른 용도의 해시와 겹치지 않게) */
const DEVICE_UNLOCK_CONTEXT = 'vault:deviceUnlock:v1';
const LOCAL_AAD = 'vault:local:v1';
const DEVICE_SECRET_BYTES = 32;

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
  private readonly versionWindowMs: number;

  private itemsKey: Uint8Array | null = null;
  private keyRecord: ItemsKeyRecord | null = null;
  private notes = new Map<string, Note>();
  private versions = new Map<string, number>();
  private listeners = new Set<(e: SessionEvent) => void>();
  /** 저장을 한 줄로 세운다. 겹쳐 들어온 저장이 서로의 이전 상태를 읽고 상대가 바꾼 칸을 지우지 않게 한다. */
  private writes: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
  /** 이번 잠금 해제 동안 백엔드의 열쇠 레코드를 확인했는지 (sync마다 Drive를 한 번 더 읽지 않게) */
  private remoteKeysChecked = false;
  /** 엔진 밖에서 난 동기화 오류(볼트 불일치). 엔진이 다음 상태를 알리면 지운다. */
  private statusOverride: SyncStatus | null = null;

  constructor(opts: VaultSessionOptions) {
    this.store = opts.store;
    this.backend = opts.backend;
    this.deviceId = opts.deviceId;
    this.deviceName = opts.deviceName ?? opts.deviceId;
    this.makeKdfParams = opts.kdfParams ?? (() => newKdfParams(opts.kdfProfile ?? 'desktop'));
    this.versionWindowMs = opts.versionWindowMs ?? 0;
    this.engine = new SyncEngine({
      store: opts.store,
      backend: opts.backend,
      deviceId: opts.deviceId,
      onConflict: (loser, winner) => this.makeConflictCopy(loser, winner),
      ...(opts.isOnline ? { isOnline: opts.isOnline } : {}),
    });
    this.engine.on((e) => {
      if (e.type === 'status') {
        this.statusOverride = null;
        this.emit({ type: 'status', status: e.status });
      }
      if (e.type === 'rollback') this.emit({ type: 'rollback', count: e.ids.length });
      // 'changed'는 sync()에서 결과를 받은 뒤 동기적으로 적용한다 (이벤트로 하면 경쟁 상태).
    });
  }

  get isLocked(): boolean {
    return this.itemsKey === null;
  }
  get status(): SyncStatus {
    return this.statusOverride ?? this.engine.status;
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

  // ---- 기기 잠금 해제 (패스키) ----
  //
  // 인증기(지문·Windows Hello)가 매번 같은 32바이트 비밀값을 돌려준다(WebAuthn PRF). 그 값으로 itemsKey를
  // 한 번 더 감싸 이 기기에만 둔다. 비밀값도, 거기서 만든 키도 저장하지 않는다 — 열 때마다 인증기가 다시 만든다.
  // 비밀번호·복구 키 경로는 그대로 남는다. 감싼 열쇠는 서버로 가지 않는다.

  /** 이 기기에서 패스키 잠금 해제를 켠다. 잠금 해제 상태에서만. */
  async enableDeviceUnlock(secret: Uint8Array, info: { credentialId: string; prfSalt: string }): Promise<void> {
    const itemsKey = this.requireUnlocked();
    await ready();
    const key = deviceKey(secret);
    try {
      await this.store.setMeta('deviceUnlock', { ...info, wrappedKey: wrap(key, itemsKey), createdAt: new Date().toISOString() });
    } finally {
      sodium.memzero(key);
    }
  }

  /** 켜져 있으면 인증기에 넘길 정보(평문 아님). 잠금 화면이 버튼을 보여줄지 정한다. */
  async deviceUnlockInfo(): Promise<{ credentialId: string; prfSalt: string } | null> {
    const rec = await this.store.getMeta('deviceUnlock');
    return rec ? { credentialId: rec.credentialId, prfSalt: rec.prfSalt } : null;
  }

  async disableDeviceUnlock(): Promise<void> {
    await this.store.deleteMeta('deviceUnlock');
  }

  async unlockWithDeviceSecret(secret: Uint8Array): Promise<void> {
    await ready();
    const rec = await this.store.getMeta('deviceUnlock');
    if (!rec) throw new NotSetUpError();
    const record = await this.loadKeyRecord();
    const key = deviceKey(secret);
    try {
      await this.unlockWith(key, rec.wrappedKey, record);
    } finally {
      sodium.memzero(key);
    }
  }

  /**
   * 이 기기에만 두는 작은 값(예: 자동 백업 비밀번호)을 itemsKey로 잠근다. 돌려준 문자열은 localStorage에 둬도 된다.
   * 잠금 해제 상태에서만 만들고 열 수 있다.
   */
  sealLocal(text: string): string {
    const itemsKey = this.requireUnlocked();
    const { nonce, ciphertext } = seal(itemsKey, fromUtf8(text), fromUtf8(LOCAL_AAD));
    return `${toBase64(nonce)}.${toBase64(ciphertext)}`;
  }

  /** 형식이 틀리거나 다른 볼트의 값이면 null. */
  openLocal(sealed: string): string | null {
    const itemsKey = this.requireUnlocked();
    const [n, c] = sealed.split('.');
    if (!n || !c) return null;
    try {
      return toUtf8(open(itemsKey, fromBase64(n), fromBase64(c), fromUtf8(LOCAL_AAD)));
    } catch {
      return null;
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
    this.remoteKeysChecked = false;
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

  /**
   * 새 메모 또는 수정. updatedAt = now, version = 이전 + 1. 암호화 → blobs, versions, outbox.
   * `snapshot: true`면 버전 기록에 반드시 새 칸을 만든다 (되돌리기처럼 직전 상태를 잃으면 안 되는 저장).
   */
  async save(input: NoteInput, opts: { snapshot?: boolean } = {}): Promise<Note> {
    this.requireUnlocked(); // 잠겨 있으면 줄을 서기 전에 바로 알린다
    return this.serial(() => this.saveNow(input, opts));
  }

  private async saveNow(input: NoteInput, opts: { snapshot?: boolean }): Promise<Note> {
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
      date: input.date !== undefined ? input.date : (prev?.date ?? null),
      secret: input.secret !== undefined ? input.secret : (prev?.secret ?? null),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.persist(note, 'put', !opts.snapshot);
    this.emit({ type: 'notes' });
    return note;
  }

  /** tombstone: deletedAt 설정 후 저장. 물리 삭제는 계정 삭제 흐름에서만. */
  async delete(id: string): Promise<void> {
    this.requireUnlocked();
    return this.serial(() => this.deleteNow(id));
  }

  private async deleteNow(id: string): Promise<void> {
    this.requireUnlocked();
    const prev = this.notes.get(id);
    if (!prev || prev.deletedAt !== null) return;
    const now = new Date().toISOString();
    await this.persist({ ...prev, updatedAt: now, deletedAt: now }, 'delete');
    this.emit({ type: 'notes' });
  }

  /**
   * 휴지통 30일 정리 (SPEC §3.1): deletedAt이 days 이전인 메모는 내용을 비우고 tombstone만 남긴다.
   * 비운 tombstone은 새 버전으로 동기화되어 다른 기기에서도 내용이 사라진다. 돌려주는 값: 비운 개수.
   */
  async purgeExpiredTrash(now = Date.now(), days = 30): Promise<number> {
    this.requireUnlocked();
    const cutoff = now - days * 86_400_000;
    let n = 0;
    for (const note of [...this.notes.values()]) {
      if (note.deletedAt === null || new Date(note.deletedAt).getTime() > cutoff) continue;
      if (note.title === '' && note.body === '' && note.tags.length === 0 && !note.secret) continue;
      await this.persist({ ...note, title: '', body: '', tags: [], folder: null, pinned: false, secret: null, updatedAt: new Date().toISOString() }, 'delete');
      n++;
    }
    if (n) this.emit({ type: 'notes' });
    return n;
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

  /** 이 메모가 디스크와 서버에 저장된 모습 그대로(암호문). "서버가 보는 모습" 화면용. */
  async rawItem(id: string): Promise<EncryptedItem | undefined> {
    this.requireUnlocked();
    return this.store.getBlob(id);
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
    return this.save({ id, title: old.note.title, body: old.note.body, tags: old.note.tags, folder: old.note.folder, date: old.note.date ?? null, secret: old.note.secret ?? null }, { snapshot: true });
  }

  // ---- 동기화 ----

  async sync(opts: { full?: boolean } = {}): Promise<SyncResult> {
    try {
      await this.ensureRemoteKeys();
    } catch (e) {
      // 오프라인이면 엔진이 'offline'을 알린다. 그 밖의 오류(볼트 불일치)는 여기서 멈춘다.
      if (!(e instanceof OfflineError)) {
        this.statusOverride = { state: 'error', message: e instanceof Error ? e.message : String(e) };
        this.emit({ type: 'status', status: this.statusOverride });
        throw e;
      }
    }
    const result = await this.engine.sync(opts);
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

  /**
   * 로컬 전용으로 시작한 볼트는 열쇠 레코드가 이 기기에만 있다. 처음 Drive와 동기화할 때 올려서
   * 새 기기가 같은 비밀번호로 열 수 있게 한다. Drive에 다른 볼트의 열쇠가 있으면 섞지 않고 멈춘다.
   * (올라가는 것은 감싼 열쇠뿐이다. 비밀번호 없이는 못 연다: DATA-MODEL.md 키 계층)
   */
  private async ensureRemoteKeys(): Promise<void> {
    const record = this.keyRecord;
    if (this.remoteKeysChecked || !record) return;
    const remote = await this.backend.getKeys();
    if (!remote.some((k) => k.id === record.id)) {
      if (remote.some((k) => k.protocol === record.protocol)) throw new VaultMismatchError();
      await this.backend.putKeys([record]);
    }
    this.remoteKeysChecked = true;
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

  private async persist(note: Note, op: 'put' | 'delete', coalesce = false): Promise<void> {
    const itemsKey = this.requireUnlocked();
    const record = this.keyRecord;
    if (!record) throw new NotSetUpError();
    const version = (this.versions.get(note.id) ?? 0) + 1;
    const item = encryptNote(itemsKey, record.id, note, this.deviceId, version);
    await this.store.putBlob(item);
    await this.store.pushVersion(item, coalesce ? { coalesceMs: this.versionWindowMs } : {});
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

/**
 * 인증기 비밀값 → 감싸기용 키. libsodium의 키 있는 해시(BLAKE2b)에 용도 문자열을 넣어 뽑는다.
 * 비밀값을 그대로 키로 쓰지 않는 이유: 같은 패스키를 다른 용도에 써도 키가 겹치지 않게.
 */
function deviceKey(secret: Uint8Array): Uint8Array {
  if (secret.length !== DEVICE_SECRET_BYTES) throw new Error(`device secret must be ${DEVICE_SECRET_BYTES} bytes`);
  return sodium.crypto_generichash(32, fromUtf8(DEVICE_UNLOCK_CONTEXT), secret);
}

/** 본문의 `#태그` 자동 인식 (SPEC §2.1). 코드 블록 안은 3단계 편집기에서 제외 처리. */
export function extractTags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) out.add(m[2] ?? '');
  out.delete('');
  return [...out];
}
