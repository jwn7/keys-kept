import { create } from 'zustand';
import { envAgeFileName, envForProject, formatEnv, sealEnv, type Note } from '@vault/core';
import type { AppSession } from './session';
import { kv } from './folderSync';
import { branchFromHead, envForBranch, envsOf, parseAiLog, parseVaultYml, type AiLogEntry, type VaultYml } from './projectConfig';

/**
 * 프로젝트를 코드 폴더에 잇기 (docs/STRATEGY.md 계획 15).
 * 사용자가 고른 폴더에 `.env.<환경>.age`(표준 age, vault-run이 읽는 모양)를 써 두고, 키가 바뀌면 다시 쓴다. 평문 .env는 만들지 않는다.
 *
 * 이 기기에만 두는 것 (IndexedDB `vault-web`/`kv`의 `codeLinks` 한 칸):
 * - 폴더 핸들: 브라우저가 주는 권한 객체 (경로 글자가 아니다)
 * - 프로젝트 이름과 파일 비밀번호: 둘 다 `session.sealLocal`로 itemsKey에 잠근 값. 잠금을 풀어야 읽힌다.
 *   (프로젝트 이름도 장부 내용이라 디스크에 평문으로 두지 않는다)
 * Chrome·Edge 데스크톱(File System Access)에서만 된다.
 */

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
};
type LinkRecord = { project: string; pass: string | null; handle: DirHandle };
const KEY = 'codeLinks';
const DEBOUNCE_MS = 1500;

export type LinkState = {
  folder: string;
  hasPass: boolean;
  permission: PermissionState;
  lastWrite: { at: string; files: string[] } | null;
  error: boolean;
};

/** 화면이 보는 상태. 프로젝트 이름 → 연결. 잠그면 비운다. */
export const useLinks = create<{ links: Record<string, LinkState> }>(() => ({ links: {} }));

/** 잠금을 푼 동안만 메모리에 두는 풀린 목록 */
let open: { project: string; record: LinkRecord }[] = [];
/** 프로젝트마다 마지막으로 본 키 내용의 지문. 바뀌면 다시 쓴다. 메모리에만 */
const seen = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<unknown>>();

export function codeLinkSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
}

async function readRecords(): Promise<LinkRecord[]> {
  try {
    return ((await kv('readonly', (s) => s.get(KEY))) as LinkRecord[] | undefined) ?? [];
  } catch {
    return [];
  }
}
async function saveRecords(): Promise<void> {
  await kv('readwrite', (s) => s.put(open.map((o) => o.record), KEY));
}

function patch(project: string, p: Partial<LinkState>) {
  useLinks.setState((s) => {
    const cur = s.links[project];
    return cur ? { links: { ...s.links, [project]: { ...cur, ...p } } } : s;
  });
}

async function permission(handle: DirHandle, request: boolean): Promise<PermissionState> {
  const q = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (q === 'granted' || !request) return q;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
}

/** 잠금을 푼 뒤 한 번. 다른 볼트의 값(열리지 않는 것)은 그대로 두고 건너뛴다. */
export async function loadLinks(app: AppSession): Promise<void> {
  if (!codeLinkSupported() || app.session.isLocked) return;
  const records = await readRecords();
  open = [];
  const links: Record<string, LinkState> = {};
  for (const record of records) {
    const project = app.session.isLocked ? null : app.session.openLocal(record.project);
    if (project === null) continue;
    open.push({ project, record });
    links[project] = { folder: record.handle.name, hasPass: !!record.pass, permission: await permission(record.handle, false).catch(() => 'denied' as const), lastWrite: null, error: false };
  }
  useLinks.setState({ links });
}

export function clearLinks(): void {
  open = [];
  seen.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  useLinks.setState({ links: {} });
}

const find = (project: string) => open.find((o) => o.project === project);

/** 사용자가 누른 단추에서 부른다. 고른 폴더 이름을 돌려준다(취소하면 null). */
export async function pickCodeFolder(app: AppSession, project: string): Promise<string | null> {
  const pick = (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<DirHandle> }).showDirectoryPicker;
  let handle: DirHandle;
  try {
    handle = await pick({ mode: 'readwrite', id: 'vault-code' });
  } catch {
    return null;
  }
  const cur = find(project);
  if (cur) cur.record = { ...cur.record, handle };
  else open.push({ project, record: { project: app.session.sealLocal(project), pass: null, handle } });
  await saveRecords();
  useLinks.setState((s) => ({ links: { ...s.links, [project]: { folder: handle.name, hasPass: !!find(project)?.record.pass, permission: 'granted', lastWrite: null, error: false } } }));
  return handle.name;
}

export async function unlinkCodeFolder(project: string): Promise<void> {
  open = open.filter((o) => o.project !== project);
  seen.delete(project);
  await saveRecords();
  useLinks.setState((s) => ({ links: Object.fromEntries(Object.entries(s.links).filter(([k]) => k !== project)) }));
}

/** 파일 비밀번호를 itemsKey로 잠가 둔다. 평문으로 저장하지 않는다. */
export async function setFilePassphrase(app: AppSession, project: string, pass: string): Promise<void> {
  const cur = find(project);
  if (!cur) return;
  cur.record = { ...cur.record, pass: app.session.sealLocal(pass) };
  await saveRecords();
  patch(project, { hasPass: true });
}

/** 사용자가 누른 단추에서 부르면 권한 창을 띄울 수 있다. */
export async function regrantCodeFolder(project: string): Promise<boolean> {
  const cur = find(project);
  if (!cur) return false;
  const p = await permission(cur.record.handle, true).catch(() => 'denied' as const);
  patch(project, { permission: p });
  return p === 'granted';
}

/** 그 프로젝트의 환경마다 쓸 파일. 환경을 정한 키가 없으면 `.env.age` 하나. */
export function keyFilesFor(notes: Note[], project: string): { name: string; env: string | null }[] {
  const envs = envsOf(notes, project);
  return (envs.length ? envs : [null]).map((env) => ({ name: envAgeFileName(env), env }));
}

function fingerprint(notes: Note[], project: string): string {
  // 값 자체를 오래 들고 있지 않도록 짧은 해시로 줄인다 (FNV-1a)
  let h = 0x811c9dc5;
  for (const f of keyFilesFor(notes, project)) {
    const text = `${f.name}\n${formatEnv(envForProject(notes, { project, env: f.env }))}`;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 키 파일을 지금 쓴다. 비밀번호가 없거나 권한이 없으면 쓰지 않고 이유를 돌려준다.
 * request: 사용자가 누른 단추에서 부를 때만 true (권한 창을 띄울 수 있다).
 */
export async function writeKeyFiles(app: AppSession, notes: Note[], project: string, request = false): Promise<'done' | 'no-pass' | 'needs-permission' | 'off' | 'failed'> {
  const cur = find(project);
  if (!cur || app.session.isLocked) return 'off';
  const run = async () => {
    const pass = cur.record.pass ? app.session.openLocal(cur.record.pass) : null;
    if (!pass) return 'no-pass' as const;
    const p = await permission(cur.record.handle, request).catch(() => 'denied' as const);
    patch(project, { permission: p });
    if (p !== 'granted') return 'needs-permission' as const;
    try {
      const files = keyFilesFor(notes, project);
      for (const f of files) {
        const bytes = await sealEnv(envForProject(notes, { project, env: f.env }), pass);
        const w = await (await cur.record.handle.getFileHandle(f.name, { create: true })).createWritable();
        await w.write(bytes as unknown as BufferSource);
        await w.close();
      }
      seen.set(project, fingerprint(notes, project));
      patch(project, { lastWrite: { at: new Date().toISOString(), files: files.map((f) => f.name) }, error: false });
      return 'done' as const;
    } catch {
      patch(project, { error: true });
      return 'failed' as const;
    }
  };
  const prev = running.get(project) ?? Promise.resolve();
  const next = prev.then(run, run);
  running.set(project, next);
  return next;
}

/**
 * 장부가 바뀔 때마다 부른다. 연결된 프로젝트의 키 내용이 바뀌었으면 잠시 뒤(입력을 멈춘 뒤) 다시 쓴다.
 * 잠금을 푼 직후 처음 본 내용은 기준으로만 삼는다(열 때마다 파일을 다시 쓰지 않는다).
 */
export function notesChanged(app: AppSession, getNotes: () => Note[]): void {
  const notes = getNotes();
  for (const { project, record } of open) {
    if (!record.pass) continue;
    const fp = fingerprint(notes, project);
    const prev = seen.get(project);
    if (prev === undefined) {
      seen.set(project, fp);
      continue;
    }
    if (prev === fp) continue;
    const t = timers.get(project);
    if (t) clearTimeout(t);
    timers.set(
      project,
      setTimeout(() => {
        timers.delete(project);
        void writeKeyFiles(app, getNotes(), project);
      }, DEBOUNCE_MS),
    );
  }
}

// ---------- 폴더 읽기 ----------

async function readText(dir: FileSystemDirectoryHandle, path: string[]): Promise<string | null> {
  try {
    let d = dir;
    for (const seg of path.slice(0, -1)) d = await d.getDirectoryHandle(seg);
    return await (await (await d.getFileHandle(path.at(-1)!)).getFile()).text();
  } catch {
    return null;
  }
}

export type FolderInfo = {
  ymlText: string | null;
  yml: VaultYml | null;
  branch: string | null;
  branchEnv: string | null;
  aiLog: AiLogEntry[];
  /** 폴더에 이미 있는 키 파일 이름 */
  files: string[];
  /** git 저장소인가 (.git/HEAD가 있다) */
  isGit: boolean;
  /** .gitignore 내용 (없으면 null) */
  gitignore: string | null;
};

/** 폴더를 읽어 화면에 보일 것을 모은다. 권한이 없으면 null. */
export async function inspectFolder(project: string, expected: string[]): Promise<FolderInfo | null> {
  const cur = find(project);
  if (!cur) return null;
  const p = await permission(cur.record.handle, false).catch(() => 'denied' as const);
  patch(project, { permission: p });
  if (p !== 'granted') return null;
  const dir = cur.record.handle;
  const [ymlText, head, log, gitignore] = await Promise.all([readText(dir, ['.vault.yml']), readText(dir, ['.git', 'HEAD']), readText(dir, ['.vault', 'ai-log.jsonl']), readText(dir, ['.gitignore'])]);
  const yml = ymlText === null ? null : parseVaultYml(ymlText);
  const branch = head === null ? null : branchFromHead(head);
  const files: string[] = [];
  for (const name of expected) if ((await readText(dir, [name])) !== null) files.push(name);
  return { ymlText, yml, branch, branchEnv: yml && branch ? envForBranch(yml.branches, branch) : null, aiLog: log === null ? [] : parseAiLog(log), files, isGit: head !== null, gitignore };
}

export const writeVaultYml = (project: string, text: string) => writeTextFile(project, '.vault.yml', text);
export const writeGitignore = (project: string, text: string) => writeTextFile(project, '.gitignore', text);

/** 사용자가 누른 단추에서 부른다 (권한 창을 띄울 수 있다). 값이 든 내용은 쓰지 않는다: .vault.yml과 .gitignore뿐. */
async function writeTextFile(project: string, name: '.vault.yml' | '.gitignore', text: string): Promise<boolean> {
  const cur = find(project);
  if (!cur) return false;
  if ((await permission(cur.record.handle, true).catch(() => 'denied' as const)) !== 'granted') return false;
  const w = await (await cur.record.handle.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
  return true;
}
