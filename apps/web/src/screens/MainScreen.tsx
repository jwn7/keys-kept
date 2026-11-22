import { useEffect, useMemo, useState } from 'react';
import type { Note } from '@vault/core';
import { flushEditor, lockNow, useApp, type Filter } from '../app/store';
import { ko } from '../i18n/ko';
import { backlinkIndex, todayTitle } from '../app/util';
import { StatusBadge } from '../components/StatusBadge';
import { BackIcon } from '../components/Icons';
import { CalendarView, CardGrid, NoteRow, QuickAdd } from './NoteViews';
import { Logo } from '../components/Seal';
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
      case 'dated':
        list = notes.filter((n) => !!n.date);
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
    // 일정: 가까운 날짜부터
    if (filter.kind === 'dated') return [...list].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
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
      void lockNow(); // 미저장 입력을 먼저 저장한 뒤 잠근다
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
  const editing = useApp((s) => s.editing);
  const view = useApp((s) => s.view);
  const actions = useNoteActions();

  // 전역 단축키 (SPEC §2.3)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // 브라우저 탭에서는 Ctrl+N이 새 창으로 가로채인다. Alt+N은 어디서나 동작한다.
      if (e.altKey && !e.ctrlKey && !e.metaKey && k === 'n') {
        e.preventDefault();
        void actions.newNote();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
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


  // 모바일 편집 화면의 상단 바: 뒤로 + 상태 + 완료만 (DESIGN.md 모바일 상단 바)
  const mobileEditing = mobileView === 'editor' && !!selectedId;
  const hideWhileEditing = mobileEditing ? ' desktop-only' : '';

  return (
    <div className="main">
      <header className="topbar">
        <div className="left">
          {mobileEditing && (
            <button type="button" className="back-btn mobile-only" aria-label={ko.main.backToList} onClick={() => useApp.getState().setMobileView('list')}>
              <BackIcon />
              {ko.main.backToListShort}
            </button>
          )}
          <Logo className="desktop-only" />
          <StatusBadge status={status} local={app.backendKind === 'memory'} />
        </div>
        <div className="right">
          <button type="button" className={`search-btn${hideWhileEditing}`} onClick={() => setPalette(true)} aria-label={ko.main.search}>
            <span>{ko.main.search}</span>
            <kbd className="desktop-only">Ctrl K</kbd>
          </button>
          <button type="button" className="btn btn-primary btn-sm desktop-only" onClick={() => void actions.newNote()} title="Alt+N">
            {ko.main.newNote}
          </button>
          {/* 왼쪽 `목록`은 이동, 오른쪽 `완료`는 이 화면의 작업(키보드 내리고 저장). 같은 곳으로 가는 버튼을 두 개 두지 않는다. */}
          {mobileEditing && editing && (
            <button
              type="button"
              className="btn btn-primary btn-sm mobile-only"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                (document.activeElement as HTMLElement | null)?.blur();
                void flushEditor();
              }}
            >
              {ko.common.done}
            </button>
          )}
          <button type="button" className={`btn btn-sm${hideWhileEditing}`} onClick={() => actions.lock()} aria-label={ko.main.lock} title="Ctrl+L">
            {ko.main.lock}
          </button>
        </div>
      </header>
      <div className="columns" data-view={mobileView} data-mode={view} data-selected={selectedId ? 'true' : 'false'}>
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
      <Item f={{ kind: 'dated' }} label={ko.main.dated} count={notes.filter((n) => n.date).length || undefined} />
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
  const sort = useApp((s) => s.sort);
  const view = useApp((s) => s.view);
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
  // 모바일에는 사이드바가 없어서 태그도 칩으로 고른다 (많이 쓴 순 8개)
  const topTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  }, [notes]);
  const title =
    filter.kind === 'folder' ? (filter.folder ?? ko.main.noFolder) : filter.kind === 'tag' ? `#${filter.tag}` : filter.kind === 'trash' ? ko.main.trash : filter.kind === 'dated' ? ko.main.dated : ko.main.allNotes;
  const inTrash = filter.kind === 'trash';

  return (
    <section className="list" aria-label={title}>
      <div className="list-top">
        <div className="list-title-row">
          <h1 className="list-title">{title}</h1>
          <button type="button" className="btn btn-sm mobile-only" onClick={() => setScreen('settings')}>{ko.main.settings}</button>
        </div>
        <div className="input-wrap sm mobile-only">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ko.main.searchNotes} aria-label={ko.main.searchNotes} />
          {query && <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setQuery('')}>×</button>}
        </div>
        {!inTrash && <QuickAdd />}
        <div className="folder-chips">
          <button type="button" aria-pressed={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>{ko.main.allNotes}</button>
          <button type="button" aria-pressed={filter.kind === 'dated'} onClick={() => setFilter({ kind: 'dated' })}>{ko.main.dated}</button>
          {folders.map((f) => (
            <button key={f} type="button" aria-pressed={filter.kind === 'folder' && filter.folder === f} onClick={() => setFilter({ kind: 'folder', folder: f })}>{f}</button>
          ))}
          {topTags.map((t) => (
            <button key={`#${t}`} type="button" aria-pressed={filter.kind === 'tag' && filter.tag === t} onClick={() => setFilter({ kind: 'tag', tag: t })}>#{t}</button>
          ))}
          <button type="button" aria-pressed={inTrash} onClick={() => setFilter({ kind: 'trash' })}>{ko.main.trash}</button>
        </div>
        <div className="list-head">
          <div className="segment" role="group" aria-label={ko.main.viewLabel}>
            {(['list', 'cards', 'calendar'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setPref('view', v)}>{ko.main.views[v]}</button>
            ))}
          </div>
          {view !== 'calendar' && filter.kind !== 'dated' && (
            <label className="sort-select">
              <span className="sr-only">{ko.main.sortLabel}</span>
              <select value={sort} onChange={(e) => setPref('sort', e.target.value as typeof sort)}>
                {(['updated', 'created', 'title'] as const).map((k) => (
                  <option key={k} value={k}>{ko.main.sort[k]}</option>
                ))}
              </select>
            </label>
          )}
          <span className="list-count">{ko.main.count(list.length)}</span>
        </div>
      </div>
      <div className="list-scroll">
        {inTrash && list.length > 0 && <p className="small muted" style={{ padding: '10px 16px 0' }}>{ko.main.trashHint}</p>}
        {view === 'calendar' && !inTrash ? (
          <CalendarView list={list} now={now} />
        ) : list.length === 0 ? (
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
        ) : view === 'cards' ? (
          <CardGrid list={list} />
        ) : (
          list.map((n) => <NoteRow key={n.id} n={n} now={now} />)
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
