import type { FolderFs } from '@vault/core';

/**
 * 폴더를 동기화 저장소로 쓰기 (docs/STRATEGY.md 계획 11). 브라우저의 File System Access로 사용자가 고른 폴더를 읽고 쓴다.
 * Chrome·Edge 데스크톱에서만 된다. 폴더에 들어가는 것은 암호문뿐이다(`<id>.enc`, `vault.json`).
 *
 * - 폴더 핸들은 브라우저가 주는 권한 객체라 IndexedDB에 둔다(경로 글자가 아니다).
 * - "이 기기는 폴더로 동기화한다"는 표시는 localStorage에 둔다. 앱이 뜰 때 바로(동기적으로) 알아야 해서다.
 * - 브라우저를 다시 열면 권한을 다시 허락해야 할 수 있다. 그때는 AuthError를 던지고, 화면이 다시 연결을 권한다.
 */
const DB = 'vault-web';
const STORE = 'kv';
const HANDLE_KEY = 'syncDir';
const FLAG = 'vault.backend';

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  entries?(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

export function folderSyncSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
}
export function folderSyncEnabled(): boolean {
  try {
    return localStorage.getItem(FLAG) === 'folder';
  } catch {
    return false;
  }
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function syncFolder(): Promise<DirHandle | null> {
  if (!folderSyncSupported()) return null;
  try {
    return ((await kv('readonly', (s) => s.get(HANDLE_KEY))) as DirHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

/** 폴더를 고르게 하고 이 기기의 저장소로 정한다. 돌려주는 값: 폴더 이름 (취소하면 null). */
export async function connectFolder(): Promise<string | null> {
  const pick = (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite' }): Promise<DirHandle> }).showDirectoryPicker;
  let dir: DirHandle;
  try {
    dir = await pick({ mode: 'readwrite' });
  } catch {
    return null; // 사용자가 창을 닫았다
  }
  await kv('readwrite', (s) => s.put(dir, HANDLE_KEY));
  localStorage.setItem(FLAG, 'folder');
  return dir.name;
}

export async function disconnectFolder(): Promise<void> {
  try {
    localStorage.removeItem(FLAG);
    await kv('readwrite', (s) => s.delete(HANDLE_KEY));
  } catch {
    /* ignore */
  }
}

/** 권한을 다시 허락받는다. 사용자가 누른 단추에서 불러야 브라우저가 창을 띄운다. */
export async function regrantFolder(): Promise<boolean> {
  const dir = await syncFolder();
  return !!dir && (await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

/** SyncEngine이 이름으로 알아보는 오류: 상태 표시가 "다시 연결"이 된다 (Drive 로그인 만료와 같은 길). */
class AuthError extends Error {
  constructor() {
    super('folder permission needed');
    this.name = 'AuthError';
  }
}

/** FolderBackend에 줄 폴더. 핸들과 권한은 처음 쓸 때 확인한다(앱이 뜰 때는 기다릴 수 없다). */
export function browserFolderFs(): FolderFs {
  const dir = async (): Promise<DirHandle> => {
    const d = await syncFolder();
    if (!d) throw new AuthError();
    if (d.queryPermission && (await d.queryPermission({ mode: 'readwrite' })) !== 'granted') throw new AuthError();
    return d;
  };
  return {
    async list() {
      const d = await dir();
      const out: string[] = [];
      if (d.entries) for await (const [name, h] of d.entries()) if (h.kind === 'file') out.push(name);
      return out;
    },
    async read(name) {
      try {
        return await (await (await (await dir()).getFileHandle(name)).getFile()).text();
      } catch (e) {
        if (e instanceof AuthError) throw e;
        return null; // 없는 파일
      }
    },
    async write(name, text) {
      const w = await (await (await dir()).getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
    async remove(name) {
      await (await dir()).removeEntry(name).catch(() => undefined);
    },
  };
}
