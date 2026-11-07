import { ConflictError, OfflineError, type SyncBackend } from '../SyncBackend';
import type { EncryptedItem, ItemsKeyRecord } from '../../model/types';

/** 토큰 공급자. 브라우저(GIS 토큰 클라이언트)·Tauri(시스템 브라우저 PKCE)가 각자 구현한다. */
export type DriveAuth = {
  getAccessToken(): Promise<string>;
};

export type DriveBackendOptions = {
  auth: DriveAuth;
  fetch?: typeof fetch;
  /** 사용자가 보는 폴더 이름. 기본 "Vault" (SPEC §3.2: appDataFolder가 아니라 보이는 폴더 + drive.file) */
  folderName?: string;
};

export class AuthError extends Error {
  constructor(message = 'drive auth failed') {
    super(message);
    this.name = 'AuthError';
  }
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const META_FILE = 'vault.json';
/** 기기 시계(updatedAt)와 서버 시계(modifiedTime) 차이를 흡수하는 여유 */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

type DriveFile = { id: string; name: string; mimeType?: string; modifiedTime?: string };
type VaultMeta = { protocol: 1; itemsKeys: ItemsKeyRecord[] };

/**
 * Google Drive 백엔드 (기본, 무료).
 *   Vault/vault.json        { protocol, itemsKeys }
 *   Vault/notes/<id>.enc    EncryptedItem JSON 1개
 * 이 클래스를 지나는 모든 바이트는 이미 암호문이다 (규칙 2).
 */
export class DriveBackend implements SyncBackend {
  readonly kind = 'drive' as const;
  private readonly auth: DriveAuth;
  private readonly fetchImpl: typeof fetch;
  private readonly folderName: string;
  private rootId: string | null = null;
  private notesId: string | null = null;
  private metaFileId: string | null = null;
  private readonly fileIds = new Map<string, string>(); // noteId → Drive fileId

  constructor(opts: DriveBackendOptions) {
    this.auth = opts.auth;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.folderName = opts.folderName ?? 'Vault';
  }

  async ping(): Promise<void> {
    await this.ensureFolders();
  }

  async list(since: string | null): Promise<EncryptedItem[]> {
    const notes = await this.ensureFolders();
    let q = `'${notes}' in parents and trashed = false`;
    if (since) {
      const from = new Date(new Date(since).getTime() - CLOCK_SKEW_MS).toISOString();
      q += ` and modifiedTime > '${from}'`;
    }
    const files = await this.listFiles(q);
    const items: EncryptedItem[] = [];
    for (const f of files) {
      if (!f.name.endsWith('.enc')) continue;
      this.fileIds.set(f.name.slice(0, -4), f.id);
      const item = await this.download<EncryptedItem>(f.id);
      if (item && (since === null || item.updatedAt > since)) items.push(item);
    }
    return items.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));
  }

  async get(id: string): Promise<EncryptedItem | null> {
    const fileId = await this.findNoteFile(id);
    return fileId ? this.download<EncryptedItem>(fileId) : null;
  }

  /** 읽기 → version 비교 → 쓰기. Drive는 LWW 파일 시스템이라 원자적이진 않다 (DATA-MODEL §백엔드 A). */
  async put(item: EncryptedItem): Promise<void> {
    const notes = await this.ensureFolders();
    const fileId = await this.findNoteFile(item.id);
    if (fileId) {
      const remote = await this.download<EncryptedItem>(fileId);
      if (remote && remote.version > item.version) throw new ConflictError(remote);
      await this.upload(fileId, null, `${item.id}.enc`, JSON.stringify(item));
      return;
    }
    const created = await this.upload(null, notes, `${item.id}.enc`, JSON.stringify(item));
    this.fileIds.set(item.id, created);
  }

  async delete(id: string, deletedAt: string): Promise<void> {
    const remote = await this.get(id);
    if (!remote) return;
    await this.put({ ...remote, deletedAt, updatedAt: deletedAt, version: remote.version + 1 });
  }

  async getKeys(): Promise<ItemsKeyRecord[]> {
    const meta = await this.readMeta();
    return meta?.itemsKeys ?? [];
  }

  async putKeys(keys: ItemsKeyRecord[]): Promise<void> {
    const root = await this.ensureFolders(true);
    const meta: VaultMeta = { protocol: 1, itemsKeys: keys };
    const fileId = await this.findMetaFile();
    if (fileId) await this.upload(fileId, null, META_FILE, JSON.stringify(meta));
    else this.metaFileId = await this.upload(null, root, META_FILE, JSON.stringify(meta));
  }

  /** 계정 삭제 흐름에서만. Vault 폴더를 통째로 지운다 (Drive가 하위 파일도 같이 지운다). */
  async purgeAll(): Promise<void> {
    const root = await this.findFolder(this.folderName, null);
    if (root) await this.request(`${API}/files/${root}`, { method: 'DELETE' });
    this.rootId = this.notesId = this.metaFileId = null;
    this.fileIds.clear();
  }

  // ---- 폴더·파일 찾기 ----

  /** Vault/ 와 Vault/notes/ 를 보장한다. rootOnly면 루트 id, 아니면 notes id를 돌려준다. */
  private async ensureFolders(rootOnly = false): Promise<string> {
    if (!this.rootId) this.rootId = (await this.findFolder(this.folderName, null)) ?? (await this.createFolder(this.folderName, null));
    if (rootOnly) return this.rootId;
    if (!this.notesId) this.notesId = (await this.findFolder('notes', this.rootId)) ?? (await this.createFolder('notes', this.rootId));
    return this.notesId;
  }

  private async findFolder(name: string, parent: string | null): Promise<string | null> {
    let q = `name = '${name}' and mimeType = '${FOLDER}' and trashed = false`;
    if (parent) q += ` and '${parent}' in parents`;
    return (await this.listFiles(q))[0]?.id ?? null;
  }

  private async createFolder(name: string, parent: string | null): Promise<string> {
    const body: Record<string, unknown> = { name, mimeType: FOLDER };
    if (parent) body.parents = [parent];
    const res = await this.request(`${API}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await res.json()) as DriveFile).id;
  }

  private async findNoteFile(id: string): Promise<string | null> {
    const cached = this.fileIds.get(id);
    if (cached) return cached;
    const notes = await this.ensureFolders();
    const found = (await this.listFiles(`name = '${id}.enc' and '${notes}' in parents and trashed = false`))[0];
    if (found) this.fileIds.set(id, found.id);
    return found?.id ?? null;
  }

  private async findMetaFile(): Promise<string | null> {
    if (this.metaFileId) return this.metaFileId;
    const root = await this.ensureFolders(true);
    const found = (await this.listFiles(`name = '${META_FILE}' and '${root}' in parents and trashed = false`))[0];
    this.metaFileId = found?.id ?? null;
    return this.metaFileId;
  }

  private async readMeta(): Promise<VaultMeta | null> {
    const fileId = await this.findMetaFile();
    return fileId ? this.download<VaultMeta>(fileId) : null;
  }

  // ---- HTTP ----

  private async listFiles(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
        pageSize: '1000',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${API}/files?${params}`);
      const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  private async download<T>(fileId: string): Promise<T | null> {
    const res = await this.request(`${API}/files/${fileId}?alt=media`, {}, [404]);
    if (res.status === 404) return null;
    return (await res.json()) as T;
  }

  /** multipart 업로드. fileId가 있으면 내용 갱신(PATCH), 없으면 parent 아래 생성(POST). 새/기존 fileId를 돌려준다. */
  private async upload(fileId: string | null, parent: string | null, name: string, content: string): Promise<string> {
    const boundary = `vault-${crypto.randomUUID()}`;
    const meta: Record<string, unknown> = fileId ? {} : { name, mimeType: 'application/json', parents: parent ? [parent] : [] };
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\ncontent-type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart` : `${UPLOAD}/files?uploadType=multipart`;
    const res = await this.request(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return ((await res.json()) as DriveFile).id;
  }

  private async request(url: string, init: RequestInit = {}, okStatuses: number[] = []): Promise<Response> {
    const token = await this.auth.getAccessToken();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
      });
    } catch {
      throw new OfflineError();
    }
    if (res.ok || okStatuses.includes(res.status)) return res;
    if (res.status === 401 || res.status === 403) throw new AuthError(`drive ${res.status}`);
    throw new Error(`drive ${res.status} on ${init.method ?? 'GET'} ${url}`);
  }
}
