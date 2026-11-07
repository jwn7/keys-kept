import { useEffect, useMemo, useState } from 'react';
import { isConflictCopy, type Note } from '@vault/core';
import { useApp, type Filter } from '../app/store';
import { ko } from '../i18n/ko';
import { backlinkIndex, displayTitle, relTime, snippet, todayTitle } from '../app/util';
import { StatusBadge } from '../components/StatusBadge';
import { Editor } from './Editor';
import { CommandPalette } from './CommandPalette';

export function useFilteredNotes(): Note[] {
  const notes = useApp((s) => s.notes);
  const trash = useApp((s) => s.trash);
  const filter = useApp((s) => s.filter);
  const sort = useApp((s) => s.sort);
  const query = useApp((s) => s.query);
  return useMemo(() => {
    let list: Note[];
    switch (filter.kind) {
      case 'all':
        list = notes;
        break;
      case 'folder':
        list = notes.filter((n) => n.folder === filter.folder);
        break;
      case 'tag':
        list = notes.filter((n) => n.tags.includes(filter.tag));
        break;
      case 'trash':
        list = trash;
        break;
    }
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
    const cmp = (a: Note, b: Note) => {
      if (filter.kind !== 'trash' && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === 'title') return a.title.localeCompare(b.title, 'ko');
      const ka = sort === 'created' ? a.createdAt : a.updatedAt;
      const kb = sort === 'created' ? b.createdAt : b.updatedAt;
      return kb.localeCompare(ka);
    };
    return [...list].sort(cmp);
  }, [notes, trash, filter, sort, query]);
}

/** 새 메모 / 오늘의 메모 / 제목으로 열기 — 팔레트·단축키·링크가 공유 */
export function useNoteActions() {
  const app = useApp((s) => s.app);
  const select = useApp((s) => s.select);
  const setFilter = useApp((s) => s.setFilter);
  return {
    async newNote(initial?: Partial<Pick<Note, 'title' | 'body' | 'folder'>>) {
      const filter = useApp.getState().filter;
      const folder = initial?.folder ?? (filter.kind === 'folder' ? filter.folder : null);
      const n = await app.session.save({ title: initial?.title ?? '', body: initial?.body ?? '', folder });
      if (filter.kind === 'trash') setFilter({ kind: 'all' });
      select(n.id);
      return n;
    },
    async openByTitle(title: string) {
      const found = useApp.getState().notes.find((n) => n.title.trim() === title.trim());
      if (found) {
        select(found.id);
        return found;
      }
      return this.newNote({ title });
    },
    async today() {
      return this.openByTitle(todayTitle());
    },
    lock() {
      app.session.lock();
    },
    async syncNow() {
      if (app.backendKind !== 'memory') await app.session.sync();
    },
  };
}

export function MainScreen() {
  const app = useApp((s) => s.app);
  const status = useApp((s) => s.status);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const setPalette = useApp((s) => s.setPalette);
  const mobileView = useApp((s) => s.mobileView);
  const selectedId = useApp((s) => s.selectedId);
  const actions = useNoteActions();

  // 전역 단축키 (SPEC §2.3)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        setPalette(!useApp.getState().paletteOpen);
      } else if (k === 'n') {
        e.preventDefault();
        void actions.newNote();
      } else if (k === 'd') {
        e.preventDefault();
        void actions.today();
      } else if (k === 'l') {
        e.preventDefault();
        actions.lock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // 마운트 시 1회


  return (
    <div className="main">
      <header className="topbar">
        <div className="left">
          <span className="logo desktop-only" style={{ fontSize: 17 }}>{ko.app.name}</span>
          <StatusBadge status={status} local={app.backendKind === 'memory'} />
        </div>
        <div className="right">
          <button type="button" className="search-btn" onClick={() => setPalette(true)} aria-label={ko.main.search}>
            <span>{ko.main.search}</span>
            <kbd className="desktop-only">Ctrl K</kbd>
          </button>
          {mobileView === 'editor' && selectedId ? (
            <button type="button" className="btn btn-primary btn-sm mobile-only" onClick={() => useApp.getState().setMobileView('list')}>
              {ko.common.done}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm desktop-only" onClick={() => void actions.newNote()}>
              {ko.main.newNote}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => actions.lock()} aria-label={ko.main.lock}>
            {ko.main.lock}
          </button>
        </div>
      </header>
      <div className="columns" data-view={mobileView}>
        <Sidebar />
        <NoteList />
        <Editor />
      </div>
      {paletteOpen && <CommandPalette />}
    </div>
  );
}

function Sidebar() {
  const notes = useApp((s) => s.notes);
  const trash = useApp((s) => s.trash);
  const filter = useApp((s) => s.filter);
  const setFilter = useApp((s) => s.setFilter);
  const setScreen = useApp((s) => s.setScreen);
  const actions = useNoteActions();
  const folders = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const n of notes) m.set(n.folder, (m.get(n.folder) ?? 0) + 1);
    const named = [...m.entries()].filter(([f]) => f !== null).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ko')) as [string, number][];
    return { named, none: m.get(null) ?? 0 };
  }, [notes]);
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [notes]);
  const is = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);
  const Item = ({ f, label, count, muted }: { f: Filter; label: string; count?: number | undefined; muted?: boolean }) => (
    <button type="button" className="nav-item" aria-current={is(f) ? 'true' : undefined} onClick={() => setFilter(f)} style={muted ? { color: 'var(--muted)' } : undefined}>
      <span>{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
  return (
    <nav className="sidebar" aria-label={ko.main.folders}>
      <div className="label">{ko.main.folders}</div>
      <Item f={{ kind: 'all' }} label={ko.main.allNotes} count={notes.length} />
      {folders.named.map(([f, c]) => (
        <Item key={f} f={{ kind: 'folder', folder: f }} label={f} count={c} />
      ))}
      {folders.none > 0 && folders.named.length > 0 && <Item f={{ kind: 'folder', folder: null }} label={ko.main.noFolder} count={folders.none} />}
      <button type="button" className="nav-item" onClick={() => void actions.today()}>
        <span>{ko.main.today}</span>
      </button>
      <Item f={{ kind: 'trash' }} label={ko.main.trash} count={trash.length || undefined} muted />
      {tags.length > 0 && <div className="label" style={{ paddingTop: 14 }}>{ko.main.tags}</div>}
      {tags.map(([t, c]) => (
        <Item key={t} f={{ kind: 'tag', tag: t }} label={`#${t}`} count={c} />
      ))}
      <div className="spacer" />
      <button type="button" className="btn btn-sm" onClick={() => setScreen('settings')}>
        {ko.main.settings}
      </button>
    </nav>
  );
}

function NoteList() {
  const list = useFilteredNotes();
  const notes = useApp((s) => s.notes);
  const filter = useApp((s) => s.filter);
  const setFilter = useApp((s) => s.setFilter);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const sort = useApp((s) => s.sort);
  const setPref = useApp((s) => s.setPref);
  const query = useApp((s) => s.query);
  const setQuery = useApp((s) => s.setQuery);
  const setScreen = useApp((s) => s.setScreen);
  const actions = useNoteActions();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const folders = useMemo(() => [...new Set(notes.map((n) => n.folder).filter((f): f is string => f !== null))].sort((a, b) => a.localeCompare(b, 'ko')), [notes]);
  const title = filter.kind === 'folder' ? (filter.folder ?? ko.main.noFolder) : filter.kind === 'tag' ? `#${filter.tag}` : filter.kind === 'trash' ? ko.main.trash : ko.main.allNotes;

  return (
    <section className="list" aria-label={title}>
      <div className="mobile-only" style={{ flexDirection: 'column', gap: 10, padding: '12px 16px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 24 }}>{title}</h1>
          <button type="button" className="btn btn-sm" onClick={() => setScreen('settings')}>{ko.main.settings}</button>
        </div>
        <div className="input-wrap sm" style={{ minHeight: 44 }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ko.palette.hints.local} aria-label={ko.main.search} />
          {query && <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setQuery('')}>×</button>}
        </div>
      </div>
      <div className="folder-chips">
        <button type="button" aria-pressed={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>{ko.main.allNotes}</button>
        {folders.map((f) => (
          <button key={f} type="button" aria-pressed={filter.kind === 'folder' && filter.folder === f} onClick={() => setFilter({ kind: 'folder', folder: f })}>{f}</button>
        ))}
        <button type="button" aria-pressed={filter.kind === 'trash'} onClick={() => setFilter({ kind: 'trash' })}>{ko.main.trash}</button>
      </div>
      <div className="list-head">
        <span>{ko.main.count(list.length)}</span>
        <div className="segment" role="group" aria-label="정렬" style={{ height: 28 }}>
          {(['updated', 'created', 'title'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setPref('sort', k)}>{ko.main.sort[k]}</button>
          ))}
        </div>
      </div>
      <div className="list-scroll">
        {filter.kind === 'trash' && list.length > 0 && <p className="small muted" style={{ padding: '10px 16px 0' }}>{ko.main.trashHint}</p>}
        {list.length === 0 ? (
          <div className="empty">
            <span>{notes.length === 0 && filter.kind === 'all' ? ko.main.emptyList : ko.main.emptyFilter}</span>
            {notes.length === 0 && filter.kind === 'all' ? (
              <button type="button" className="btn btn-sm" onClick={() => void actions.newNote()}>{ko.main.firstNote}</button>
            ) : (
              (filter.kind !== 'all' || query) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setFilter({ kind: 'all' });
                    setQuery('');
                  }}
                >
                  {ko.main.resetFilter}
                </button>
              )
            )}
          </div>
        ) : (
          list.map((n) => (
            <button key={n.id} type="button" className="note-row" aria-current={n.id === selectedId ? 'true' : undefined} onClick={() => select(n.id)}>
              <div className="t">
                <span>{n.pinned && <span className="pin">📌 </span>}{displayTitle(n)}</span>
                <time dateTime={n.updatedAt}>{relTime(n.updatedAt, now)}</time>
              </div>
              <div className="s">{snippet(n.body) || ' '}</div>
              {isConflictCopy(n) && <div className="conflict-flag">⚠ {n.title.slice(n.title.indexOf('(충돌 사본') + 1, -1)}</div>}
            </button>
          ))
        )}
      </div>
      <div className="fab-bar">
        <button type="button" className="btn btn-primary fab" onClick={() => void actions.newNote()}>+ {ko.main.newNote}</button>
      </div>
    </section>
  );
}

export function useBacklinks(id: string | null): Note[] {
  const notes = useApp((s) => s.notes);
  const idx = useMemo(() => backlinkIndex(notes), [notes]);
  return id ? (idx.get(id) ?? []) : [];
}
