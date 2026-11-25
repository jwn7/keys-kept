import { ConflictError, type SyncBackend } from '../SyncBackend';
import type { EncryptedItem, ItemsKeyRecord } from '../../model/types';

/**
 * 폴더 하나를 저장소로 쓴다 (docs/STRATEGY.md 계획 11).
 * Google Drive 계정 없이도 동기화할 수 있게 하려는 것이다: 이 폴더를 Dropbox·iCloud·Syncthing·NAS처럼
 * 사용자가 이미 쓰는 도구가 옮기게 두면 된다. 폴더에 들어가는 것은 다른 백엔드와 똑같이 암호문뿐이다.
 *
 * 폴더를 읽고 쓰는 방법은 환경마다 다르므로(브라우저의 File System Access, Node의 fs) 작은 인터페이스로 받는다.
 */
export interface FolderFs {
  /** 폴더 안의 파일 이름들 (하위 폴더 제외) */
  list(): Promise<string[]>;
  /** 없으면 null */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const KEYS_FILE = 'vault.json';
const EXT = '.enc';
const itemFile = (id: string) => `${id}${EXT}`;
/** 파일 이름으로 쓰기 전에 id를 확인한다. 경로 글자가 섞인 id로 폴더 밖을 건드리지 못하게. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export class FolderBackend implements SyncBackend {
  readonly kind = 'folder' as const;
  private readonly fs: FolderFs;

  constructor(opts: { fs: FolderFs }) {
    this.fs = opts.fs;
  }

  async ping(): Promise<void> {
    await this.fs.list();
  }

  async list(since: string | null): Promise<EncryptedItem[]> {
    const names = (await this.fs.list()).filter((n) => n.endsWith(EXT));
    const items: EncryptedItem[] = [];
    for (const n of names) {
      const item = await this.readItem(n.slice(0, -EXT.length));
      if (item && (since === null || item.updatedAt > since)) items.push(item);
    }
    return items.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));
  }

  get(id: string): Promise<EncryptedItem | null> {
    return this.readItem(id);
  }

  async put(item: EncryptedItem): Promise<void> {
    if (!SAFE_ID.test(item.id)) throw new Error(`unsafe item id: ${item.id}`);
    const remote = await this.readItem(item.id);
    if (remote && remote.version > item.version) throw new ConflictError(remote);
    await this.fs.write(itemFile(item.id), JSON.stringify(item));
  }

  async delete(id: string, deletedAt: string): Promise<void> {
    const remote = await this.readItem(id);
    if (!remote) return;
    await this.fs.write(itemFile(id), JSON.stringify({ ...remote, deletedAt, updatedAt: deletedAt, version: remote.version + 1 }));
  }

  async getKeys(): Promise<ItemsKeyRecord[]> {
    const text = await this.fs.read(KEYS_FILE);
    if (!text) return [];
    try {
      const parsed = JSON.parse(text) as { keys?: ItemsKeyRecord[] };
      return Array.isArray(parsed.keys) ? parsed.keys : [];
    } catch {
      return [];
    }
  }

  async putKeys(keys: ItemsKeyRecord[]): Promise<void> {
    await this.fs.write(KEYS_FILE, JSON.stringify({ keys }));
  }

  async purgeAll(): Promise<void> {
    for (const n of await this.fs.list()) {
      if (n === KEYS_FILE || n.endsWith(EXT)) await this.fs.remove(n);
    }
  }

  /** 깨졌거나(동기화 도구가 쓰는 중) 우리 파일이 아닌 것은 없는 것으로 본다. 다음 동기화에서 다시 읽는다. */
  private async readItem(id: string): Promise<EncryptedItem | null> {
    if (!SAFE_ID.test(id)) return null;
    const text = await this.fs.read(itemFile(id));
    if (!text) return null;
    try {
      const item = JSON.parse(text) as EncryptedItem;
      return item && item.id === id && typeof item.ciphertext === 'string' ? item : null;
    } catch {
      return null;
    }
  }
}

/** 메모리 안의 폴더. 테스트용이고, 두 세션이 같은 인스턴스를 쓰면 "같은 폴더를 보는 두 기기"가 된다. */
export class MemoryFolderFs implements FolderFs {
  readonly files = new Map<string, string>();
  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async read(name: string): Promise<string | null> {
    return this.files.get(name) ?? null;
  }
  async write(name: string, text: string): Promise<void> {
    this.files.set(name, text);
  }
  async remove(name: string): Promise<void> {
    this.files.delete(name);
  }
}
