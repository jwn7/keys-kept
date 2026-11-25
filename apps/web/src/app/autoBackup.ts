import { backupFileName, exportBackup } from '@vault/core';
import type { AppSession } from './session';

/**
 * 자동 로컬 백업 (SPEC §4). 사용자가 고른 폴더에 하루 한 번 `vault-YYYY-MM-DD.age`를 쓴다. 서버를 거치지 않는다.
 *
 * - 폴더 핸들은 브라우저가 주는 권한 객체라 IndexedDB에 그대로 둔다(경로 문자열이 아니다).
 * - 백업 비밀번호는 itemsKey로 잠가(session.sealLocal) localStorage에 둔다. 잠금을 풀어야만 읽을 수 있다.
 * - File System Access API가 있는 브라우저(Chrome·Edge 데스크톱)에서만 동작한다.
 */
const DB = 'vault-web';
const STORE = 'kv';
const HANDLE_KEY = 'backupDir';
const PASS_KEY = 'vault.autoBackup.pass';
const LAST_KEY = 'vault.autoBackup.last';
export const KEEP_BACKUPS = 14;
const NAME_RE = /^vault-\d{4}-\d{2}-\d{2}\.age$/;

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  keys?(): AsyncIterableIterator<string>;
};
export type AutoBackupResult = 'off' | 'needs-permission' | 'skipped' | 'done';

export function autoBackupSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
}

/** 지울 파일: 이 앱이 만든 이름(vault-날짜.age)만 대상으로, 최근 keep개를 남긴다. 다른 파일은 건드리지 않는다. */
export function backupsToDelete(names: string[], keep = KEEP_BACKUPS): string[] {
  const ours = names.filter((n) => NAME_RE.test(n)).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
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

export async function backupFolder(): Promise<DirHandle | null> {
  if (!autoBackupSupported()) return null;
  try {
    return ((await kv('readonly', (s) => s.get(HANDLE_KEY))) as DirHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

/** 사용자 제스처 안에서 부른다. 폴더를 고르고 비밀번호를 잠가 둔다. */
export async function enableAutoBackup(app: AppSession, passphrase: string): Promise<string> {
  const pick = (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<DirHandle> }).showDirectoryPicker;
  const handle = await pick({ mode: 'readwrite', id: 'vault-backup' });
  await kv('readwrite', (s) => s.put(handle, HANDLE_KEY));
  localStorage.setItem(PASS_KEY, app.session.sealLocal(passphrase));
  localStorage.removeItem(LAST_KEY);
  return handle.name;
}

export async function disableAutoBackup(): Promise<void> {
  try {
    await kv('readwrite', (s) => s.delete(HANDLE_KEY));
  } catch {
    /* ignore */
  }
  localStorage.removeItem(PASS_KEY);
  localStorage.removeItem(LAST_KEY);
}

export async function folderPermission(handle: DirHandle, request = false): Promise<PermissionState> {
  const q = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (q === 'granted' || !request) return q;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
}

/**
 * 오늘 아직 안 했으면 백업한다. force면 날짜와 상관없이 지금.
 * 권한 요청 창은 여기서 띄우지 않는다(자동 실행이라 사용자 제스처가 없다). 필요하면 'needs-permission'.
 */
export async function runAutoBackup(app: AppSession, opts: { force?: boolean; now?: Date } = {}): Promise<AutoBackupResult> {
  if (app.session.isLocked) return 'off';
  const handle = await backupFolder();
  const sealed = localStorage.getItem(PASS_KEY);
  if (!handle || !sealed) return 'off';
  const pass = app.session.openLocal(sealed);
  if (!pass) return 'off';
  if ((await folderPermission(handle)) !== 'granted') return 'needs-permission';
  const now = opts.now ?? new Date();
  const name = backupFileName(now);
  if (!opts.force && localStorage.getItem(LAST_KEY) === name) return 'skipped';
  const notes = app.session.list();
  if (notes.length === 0) return 'skipped';
  const bytes = await exportBackup(notes, pass, app.deviceName);
  const file = await handle.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  localStorage.setItem(LAST_KEY, name);
  // 오래된 것 정리 (실패해도 백업 자체는 끝났다)
  try {
    const names: string[] = [];
    if (handle.keys) for await (const k of handle.keys()) names.push(k);
    for (const old of backupsToDelete(names)) await handle.removeEntry(old);
  } catch {
    /* ignore */
  }
  return 'done';
}
