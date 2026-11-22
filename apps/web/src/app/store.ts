import { create } from 'zustand';
import type { Note, SyncStatus } from '@vault/core';
import type { AppSession } from './session';
import { createAppSession } from './session';

export type Filter = { kind: 'all' } | { kind: 'dated' } | { kind: 'folder'; folder: string | null } | { kind: 'tag'; tag: string } | { kind: 'trash' };
export type SortKey = 'updated' | 'created' | 'title';
export type Theme = 'light' | 'dark' | 'system';
export type FontSize = 's' | 'm' | 'l';
export type Screen = 'loading' | 'setup' | 'unlock' | 'main' | 'settings';
export type MobileView = 'list' | 'editor';
export type EditorWidth = 'narrow' | 'normal' | 'wide';
export type ViewMode = 'list' | 'cards' | 'calendar';
export type CalBasis = 'date' | 'created';

type Prefs = { theme: Theme; fontSize: FontSize; autoLockMin: number; sort: SortKey; editorWidth: EditorWidth; view: ViewMode; calBasis: CalBasis };
const PREFS_KEY = 'vault.prefs';
function loadPrefs(): Prefs {
  const d: Prefs = { theme: 'system', fontSize: 'm', autoLockMin: 15, sort: 'updated', editorWidth: 'normal', view: 'list', calBasis: 'date' };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return d;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export type AppState = Prefs & {
  app: AppSession;
  screen: Screen;
  locked: boolean;
  notes: Note[];
  trash: Note[];
  status: SyncStatus;
  selectedId: string | null;
  filter: Filter;
  query: string;
  paletteOpen: boolean;
  mobileView: MobileView;
  /** 제목·본문에 커서가 있는 동안 true. 모바일 상단의 `완료`(키보드 내리기)를 이때만 보여준다. */
  editing: boolean;
  /** 캘린더가 보여주는 달 `YYYY-MM`과 고른 날 */
  calMonth: string;
  calDay: string | null;
  lastBackupAt: string | null;
  // actions
  setScreen(s: Screen): void;
  select(id: string | null): void;
  setFilter(f: Filter): void;
  setQuery(q: string): void;
  setPalette(open: boolean): void;
  setMobileView(v: MobileView): void;
  setEditing(v: boolean): void;
  setCal(c: { month?: string; day?: string | null }): void;
  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void;
  setLastBackup(at: string): void;
  refresh(): void;
};

export const useApp = create<AppState>((set, get) => {
  const app = createAppSession();
  const prefs = loadPrefs();
  const pull = () => {
    const { session } = app;
    if (session.isLocked) return { locked: true, notes: [], trash: [] };
    return { locked: false, notes: session.list(), trash: session.listDeleted() };
  };
  app.session.subscribe((e) => {
    if (e.type === 'status') set({ status: e.status });
    else if (e.type === 'notes') set(pull());
    else if (e.type === 'lock') {
      // setup 화면은 복구 문구를 보여준 뒤 스스로 main으로 넘어간다.
      const screen = e.locked ? 'unlock' : get().screen === 'setup' ? 'setup' : 'main';
      set({ ...pull(), screen, selectedId: e.locked ? null : get().selectedId, paletteOpen: false });
      if (e.locked) app.scheduler.stop();
      else {
        void app.session.purgeExpiredTrash(); // 휴지통 30일 정리 (SPEC §3.1)
        if (app.backendKind !== 'memory') app.scheduler.start();
      }
    }
  });
  let last: string | null = null;
  try {
    last = localStorage.getItem('vault.lastBackupAt');
  } catch {
    /* ignore */
  }
  return {
    ...prefs,
    app,
    screen: 'loading',
    locked: true,
    notes: [],
    trash: [],
    status: app.backendKind !== 'memory' ? { state: 'offline', pending: 0 } : { state: 'synced', at: '' },
    selectedId: null,
    filter: { kind: 'all' },
    query: '',
    paletteOpen: false,
    mobileView: 'list',
    editing: false,
    calMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    calDay: null,
    lastBackupAt: last,
    setScreen: (screen) => set({ screen }),
    select: (selectedId) => set({ selectedId, mobileView: selectedId ? 'editor' : 'list' }),
    setFilter: (filter) => set({ filter, mobileView: 'list' }),
    setQuery: (query) => set({ query }),
    setPalette: (paletteOpen) => set({ paletteOpen }),
    setMobileView: (mobileView) => set({ mobileView }),
    setEditing: (editing) => set({ editing }),
    setCal: ({ month, day }) => set((s) => ({ calMonth: month ?? (day ? day.slice(0, 7) : s.calMonth), calDay: day !== undefined ? day : s.calDay })),
    setPref: (k, v) => {
      set({ [k]: v } as Partial<AppState>);
      const s = get();
      savePrefs({ theme: s.theme, fontSize: s.fontSize, autoLockMin: s.autoLockMin, sort: s.sort, editorWidth: s.editorWidth, view: s.view, calBasis: s.calBasis });
    },
    setLastBackup: (at) => {
      set({ lastBackupAt: at });
      try {
        localStorage.setItem('vault.lastBackupAt', at);
      } catch {
        /* ignore */
      }
    },
    refresh: () => set(pull()),
  };
});

/**
 * 편집기가 아직 저장하지 않은 입력(1초 디바운스 대기분)을 지금 저장하게 하는 훅.
 * 잠금은 메모리의 열쇠를 지우므로, 잠그기 전에 반드시 이걸 먼저 기다려야 마지막 입력이 사라지지 않는다.
 */
let editorFlush: (() => Promise<void>) | null = null;
export function registerEditorFlush(fn: () => Promise<void>): () => void {
  editorFlush = fn;
  return () => {
    if (editorFlush === fn) editorFlush = null;
  };
}
export async function flushEditor(): Promise<void> {
  try {
    await editorFlush?.();
  } catch {
    /* 저장 실패는 편집기가 표시한다 */
  }
}
/** 수동 잠금·자동 잠금·단축키가 모두 이 함수를 쓴다. */
export async function lockNow(): Promise<void> {
  await flushEditor();
  useApp.getState().app.session.lock();
}

/** 처음 부팅: 로컬 열쇠 유무로 setup/unlock 분기. */
export async function bootApp(): Promise<void> {
  const { app, setScreen } = useApp.getState();
  const has = await app.session.hasLocalKeys();
  if (!has && app.backendKind !== 'memory') {
    // Drive에 연결된 새 기기: 백엔드에서 키를 받아올 수 있는지 unlock이 판단한다.
    setScreen('unlock');
    return;
  }
  setScreen(has ? 'unlock' : 'setup');
}
