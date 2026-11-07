import { create } from 'zustand';
import type { Note, SyncStatus } from '@vault/core';
import type { AppSession } from './session';
import { createAppSession } from './session';

export type Filter = { kind: 'all' } | { kind: 'folder'; folder: string | null } | { kind: 'tag'; tag: string } | { kind: 'trash' };
export type SortKey = 'updated' | 'created' | 'title';
export type Theme = 'light' | 'dark' | 'system';
export type FontSize = 's' | 'm' | 'l';
export type Screen = 'loading' | 'setup' | 'unlock' | 'main' | 'settings';
export type MobileView = 'list' | 'editor';

type Prefs = { theme: Theme; fontSize: FontSize; autoLockMin: number; sort: SortKey };
const PREFS_KEY = 'vault.prefs';
function loadPrefs(): Prefs {
  const d: Prefs = { theme: 'system', fontSize: 'm', autoLockMin: 15, sort: 'updated' };
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
  lastBackupAt: string | null;
  // actions
  setScreen(s: Screen): void;
  select(id: string | null): void;
  setFilter(f: Filter): void;
  setQuery(q: string): void;
  setPalette(open: boolean): void;
  setMobileView(v: MobileView): void;
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
        if (app.backendKind === 'drive') app.scheduler.start();
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
    status: app.backendKind === 'drive' ? { state: 'offline', pending: 0 } : { state: 'synced', at: '' },
    selectedId: null,
    filter: { kind: 'all' },
    query: '',
    paletteOpen: false,
    mobileView: 'list',
    lastBackupAt: last,
    setScreen: (screen) => set({ screen }),
    select: (selectedId) => set({ selectedId, mobileView: selectedId ? 'editor' : 'list' }),
    setFilter: (filter) => set({ filter, mobileView: 'list' }),
    setQuery: (query) => set({ query }),
    setPalette: (paletteOpen) => set({ paletteOpen }),
    setMobileView: (mobileView) => set({ mobileView }),
    setPref: (k, v) => {
      set({ [k]: v } as Partial<AppState>);
      const s = get();
      savePrefs({ theme: s.theme, fontSize: s.fontSize, autoLockMin: s.autoLockMin, sort: s.sort });
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

/** 처음 부팅: 로컬 열쇠 유무로 setup/unlock 분기. */
export async function bootApp(): Promise<void> {
  const { app, setScreen } = useApp.getState();
  const has = await app.session.hasLocalKeys();
  if (!has && app.backendKind === 'drive') {
    // Drive에 연결된 새 기기: 백엔드에서 키를 받아올 수 있는지 unlock이 판단한다.
    setScreen('unlock');
    return;
  }
  setScreen(has ? 'unlock' : 'setup');
}
