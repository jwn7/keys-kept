import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { extractTags, envForProject, type Note } from '@vault/core';
import { CompareTable, copySecret, downloadProjectEnv, downloadSealedEnv, ExportMenu, IncidentView, ShareDialog, envsOf, EnvImportDialog, projectEnvText } from './KeyViews';
import { flushEditor, lockNow, useApp, type Filter } from '../app/store';
import { ko } from '../i18n/ko';
import { backlinkIndex, searchScore, searchTokens, todayTitle } from '../app/util';
import { StatusBadge } from '../components/StatusBadge';
import { AlertIcon, BackIcon, CalendarIcon, FolderIcon, GearIcon, KeyIcon, LockIcon, NotesIcon, PlusIcon, SearchIcon, TagIcon, TodayIcon, TrashIcon } from '../components/Icons';
import { CalendarView, CardGrid, NoteRow, QuickAdd, TodayView } from './NoteViews';
import { markCapture } from '../app/metrics';
import { Logo } from '../components/Seal';
import { Editor } from './Editor';
import { CommandPalette } from './CommandPalette';

export function useFilteredNotes(): Note[] {
  const notes = useApp((s) => s.notes);
  const trash = useApp((s) => s.trash);
  const filter = useApp((s) => s.filter);
  const sort = useApp((s) => s.sort);
  const query = useApp((s) => s.query);
  const envFilter = useApp((s) => s.envFilter);
  return useMemo(() => {
    let list: Note[];
    switch (filter.kind) {
      case 'today':
        list = notes;
        break;
      case 'keys':
        list = notes.filter((n) => !!n.secret);
        break;
      case 'incident':
        list = [];
        break;
      case 'all': // 메모만. 키는 '모든 키'와 프로젝트에서 본다
        list = notes.filter((n) => !n.secret);
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
    // 환경을 고르면 그 환경의 키와 공통 키만 (메모는 그대로 둔다)
    if (envFilter) list = list.filter((n) => !n.secret || n.secret.env === null || n.secret.env === envFilter);
    const tokens = searchTokens(query);
    if (tokens.length) list = list.filter((n) => searchScore(n, tokens) > 0);
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
  }, [notes, trash, filter, sort, query, envFilter]);
}

/** 새 메모 / 오늘의 메모 / 제목으로 열기 — 팔레트·단축키·링크가 공유 */
export function useNoteActions() {
  const app = useApp((s) => s.app);
  const select = useApp((s) => s.select);
  const setFilter = useApp((s) => s.setFilter);
  return {
    async newNote(initial?: Partial<Pick<Note, 'title' | 'body' | 'folder' | 'date'>>) {
      const filter = useApp.getState().filter;
      const folder = initial?.folder ?? (filter.kind === 'folder' ? filter.folder : null);
      const body = initial?.body ?? '';
      markCapture('new');
      const n = await app.session.save({ title: initial?.title ?? '', body, folder, date: initial?.date ?? null, tags: extractTags(body) });
      if (filter.kind === 'trash') setFilter({ kind: 'all' });
      select(n.id);
      return n;
    },
    /** 빈 키 항목을 만들어 연다. 프로젝트 화면이면 그 프로젝트에, 환경을 골라 뒀으면 그 환경으로. */
    async newKey() {
      const { filter, envFilter } = useApp.getState();
      markCapture('new');
      const n = await app.session.save({ title: '', folder: filter.kind === 'folder' ? filter.folder : null, secret: { value: '', env: envFilter, usedIn: [] } });
      if (filter.kind === 'trash' || filter.kind === 'all' || filter.kind === 'dated' || filter.kind === 'tag') setFilter({ kind: 'keys' });
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
    /** 틀에서 새 메모: 회의록(누가 무엇을), 하루 계획(오늘 일정으로), 학습 노트(#복습 → 다시 볼 메모) */
    async template(kind: keyof typeof ko.templates) {
      const now = new Date();
      const t = ko.templates[kind];
      return this.newNote({ title: t.title(ko.time.date(now.getMonth() + 1, now.getDate())), body: t.body, date: kind === 'plan' ? todayTitle(now) : null });
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
  const isToday = useApp((s) => s.filter.kind === 'today' || s.filter.kind === 'incident');
  const comparing = useApp((s) => s.compare && s.filter.kind === 'folder');
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


  // 앱 아이콘 바로가기(/?action=new|today): 잠금을 푼 뒤 한 번 실행하고 주소에서 지운다
  useEffect(() => {
    const action = new URLSearchParams(window.location.search).get('action');
    if (action !== 'new' && action !== 'today') return;
    window.history.replaceState(null, '', window.location.pathname);
    if (action === 'new') void actions.newNote();
    else void actions.today();
  }, []); // 마운트 시 1회

  // 모바일 편집 화면의 상단 바: 뒤로 + 상태 + 완료만 (DESIGN.md 모바일 상단 바)
  const mobileEditing = mobileView === 'editor' && !!selectedId;

  return (
    <div className="main">
      {/* 모바일 전용 상단 바. PC에는 가로 바가 없다: 내비게이션이 내용보다 튀지 않게 사이드바로 모았다. */}
      <header className="topbar mobile-only">
        <div className="left">
          {mobileEditing && (
            <button type="button" className="back-btn" aria-label={ko.main.backToList} onClick={() => useApp.getState().setMobileView('list')}>
              <BackIcon />
              {ko.main.backToListShort}
            </button>
          )}
          <StatusBadge status={status} local={app.backendKind === 'memory'} />
        </div>
        <div className="right">
          {!mobileEditing && (
            <button type="button" className="search-btn" onClick={() => setPalette(true)} aria-label={ko.main.search}>
              <SearchIcon />
              <span>{ko.main.search}</span>
            </button>
          )}
          {/* 왼쪽 `목록`은 이동, 오른쪽 `완료`는 이 화면의 작업(키보드 내리고 저장). 같은 곳으로 가는 버튼을 두 개 두지 않는다. */}
          {mobileEditing && editing && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                (document.activeElement as HTMLElement | null)?.blur();
                void flushEditor();
              }}
            >
              {ko.common.done}
            </button>
          )}
          {!mobileEditing && (
            <button type="button" className="btn btn-sm" onClick={() => actions.lock()}>
              {ko.main.lock}
            </button>
          )}
        </div>
      </header>
      <div className="columns" data-view={mobileView} data-mode={comparing ? 'cards' : isToday ? 'list' : view} data-selected={selectedId ? 'true' : 'false'}>
        <Sidebar />
        <NoteList />
        <Editor />
      </div>
      {paletteOpen && <CommandPalette />}
      <EnvImportHost />
    </div>
  );
}

/**
 * 사이드바 항목. Sidebar 안에서 정의하면 Sidebar가 다시 그려질 때마다 버튼이 새로 만들어져,
 * 편집 중에 누른 클릭(누르는 순간 저장 → 다시 그림)이 사라진다. 그래서 바깥에 둔다.
 */
function Item({ f, label, count, icon }: { f: Filter; label: string; count?: number | undefined; icon: ReactNode }) {
  const current = useApp((s) => JSON.stringify(s.filter) === JSON.stringify(f));
  const setFilter = useApp((s) => s.setFilter);
  return (
    <button type="button" className="nav-item" aria-current={current ? 'true' : undefined} onClick={() => setFilter(f)}>
      {icon}
      <span>{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

function EnvImportHost() {
  const envImport = useApp((s) => s.envImport);
  const filter = useApp((s) => s.filter);
  if (!envImport) return null;
  return <EnvImportDialog initialText={envImport.text} project={filter.kind === 'folder' ? filter.folder : null} onClose={() => useApp.getState().setEnvImport(null)} />;
}

function Sidebar() {
  const app = useApp((s) => s.app);
  const status = useApp((s) => s.status);
  const notes = useApp((s) => s.notes);
  const trash = useApp((s) => s.trash);
  const filter = useApp((s) => s.filter);
  const setFilter = useApp((s) => s.setFilter);
  const setScreen = useApp((s) => s.setScreen);
  const setPalette = useApp((s) => s.setPalette);
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
  const now = new Date();
  return (
    <nav className="sidebar" aria-label={ko.main.folders}>
      <div className="side-head">
        <Logo />
      </div>
      <button type="button" className="side-search" onClick={() => setPalette(true)}>
        <SearchIcon />
        <span>{ko.main.search}</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button type="button" className="nav-item" aria-current={filter.kind === 'today' ? 'true' : undefined} onClick={() => setFilter({ kind: 'today' })}>
        <TodayIcon />
        <span>{ko.main.home}</span>
        <span className="count">{ko.time.date(now.getMonth() + 1, now.getDate())}</span>
      </button>
      <Item f={{ kind: 'keys' }} label={ko.main.allKeys} count={notes.filter((n) => n.secret).length || undefined} icon={<KeyIcon />} />
      <Item f={{ kind: 'all' }} label={ko.main.allNotes} count={notes.filter((n) => !n.secret).length} icon={<NotesIcon />} />
      <Item f={{ kind: 'dated' }} label={ko.main.dated} count={notes.filter((n) => n.date).length || undefined} icon={<CalendarIcon />} />
      {folders.named.length > 0 && <div className="label">{ko.main.folders}</div>}
      {folders.named.map(([f, c]) => (
        <Item key={f} f={{ kind: 'folder', folder: f }} label={f} count={c} icon={<FolderIcon />} />
      ))}
      {folders.none > 0 && folders.named.length > 0 && <Item f={{ kind: 'folder', folder: null }} label={ko.main.noFolder} count={folders.none} icon={<FolderIcon />} />}
      {tags.length > 0 && <div className="label">{ko.main.tags}</div>}
      {tags.map(([t, c]) => (
        <Item key={t} f={{ kind: 'tag', tag: t }} label={t} count={c} icon={<TagIcon />} />
      ))}
      <div className="spacer" />
      <Item f={{ kind: 'incident' }} label={ko.main.incident} icon={<AlertIcon />} />
      <Item f={{ kind: 'trash' }} label={ko.main.trash} count={trash.length || undefined} icon={<TrashIcon />} />
      <div className="side-foot">
        <StatusBadge status={status} local={app.backendKind === 'memory'} />
        <div className="side-actions">
          <button type="button" className="nav-item" onClick={() => setScreen('settings')}>
            <GearIcon />
            <span>{ko.main.settings}</span>
          </button>
          <button type="button" className="nav-item" onClick={() => actions.lock()} title="Ctrl+L">
            <LockIcon />
            <span>{ko.main.lock}</span>
          </button>
        </div>
      </div>
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
    filter.kind === 'folder' ? (filter.folder ?? ko.main.noFolder) : filter.kind === 'tag' ? `#${filter.tag}` : filter.kind === 'trash' ? ko.main.trash : filter.kind === 'dated' ? ko.main.dated : filter.kind === 'today' ? ko.main.home : filter.kind === 'keys' ? ko.main.allKeys : filter.kind === 'incident' ? ko.main.incident : ko.main.allNotes;
  const inTrash = filter.kind === 'trash';
  const isIncident = filter.kind === 'incident';
  const isToday = filter.kind === 'today';
  const home = isToday || filter.kind === 'all';
  const envFilter = useApp((s) => s.envFilter);
  const setEnvFilter = useApp((s) => s.setEnvFilter);
  const setEnvImport = useApp((s) => s.setEnvImport);
  // 키를 넣는 화면: 오늘, 모든 키, 프로젝트
  const keyScreen = isToday || filter.kind === 'keys' || filter.kind === 'folder';
  const compare = useApp((s) => s.compare) && filter.kind === 'folder';
  const setCompare = useApp((s) => s.setCompare);
  const noList = isToday || isIncident || compare; // 목록 대신 자기 화면을 그리는 곳: 보기 방식·정렬을 숨긴다
  const project = filter.kind === 'folder' ? filter.folder : null;
  const envs = useMemo(() => (filter.kind === 'folder' ? envsOf(notes, project) : []), [notes, filter.kind, project]);
  const projectHasKeys = filter.kind === 'folder' && notes.some((n) => n.secret && n.folder === project);
  const [sharing, setSharing] = useState(false);
  const copyEnv = async () => {
    const r = await projectEnvText(notes, project, envFilter);
    if (r) await copySecret(r.text, ko.keys.copiedEnv(envForProject(notes, { project, env: r.env }).length));
  };

  return (
    <section className="list" aria-label={title}>
      <div className="list-top">
        <div className="list-title-row">
          <h1 className="list-title">{title}</h1>
          <button type="button" className="btn btn-sm mobile-only" onClick={() => setScreen('settings')}>{ko.main.settings}</button>
          {filter.kind !== 'keys' && !inTrash && !isIncident && (
            <button type="button" className={`btn btn-sm desktop-only${keyScreen ? '' : ' btn-primary'}`} onClick={() => void actions.newNote()} title="Alt+N">
              <PlusIcon />
              {ko.main.newNote}
            </button>
          )}
          {keyScreen && (
            <button type="button" className="btn btn-primary btn-sm desktop-only" onClick={() => void actions.newKey()}>
              <PlusIcon />
              {ko.main.newKey}
            </button>
          )}
        </div>
        {!inTrash && !isIncident && <QuickAdd />}
        <div className="folder-chips">
          <button type="button" aria-pressed={isToday} onClick={() => setFilter({ kind: 'today' })}>{ko.main.home}</button>
          <button type="button" aria-pressed={filter.kind === 'keys'} onClick={() => setFilter({ kind: 'keys' })}>{ko.main.allKeys}</button>
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
        {keyScreen && !isIncident && (
          <div className="env-bar">
            {envs.length > 0 && (
              <div className="segment" role="group" aria-label={ko.keys.env}>
                <button type="button" aria-pressed={envFilter === null} onClick={() => setEnvFilter(null)}>{ko.keys.envAll}</button>
                {envs.map((e) => (
                  <button key={e} type="button" aria-pressed={envFilter === e} onClick={() => setEnvFilter(e)}>{e}</button>
                ))}
              </div>
            )}
            {envs.length > 0 && (
              <button type="button" className="btn btn-sm" aria-pressed={compare} onClick={() => setCompare(!compare)}>{ko.keys.compare}</button>
            )}
            <span className="env-bar-gap" />
            <button type="button" className="btn-link" onClick={() => setEnvImport({ text: '' })}>{ko.keys.importOpen}</button>
            {projectHasKeys && (
              <ExportMenu
                onCopy={() => void copyEnv()}
                onSealed={() => void downloadSealedEnv(notes, project, envFilter)}
                onShare={() => setSharing(true)}
                onPlain={() => void downloadProjectEnv(notes, project, envFilter)}
              />
            )}
          </div>
        )}
        {!noList && <div className="list-head">
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
        </div>}
      </div>
      <div className="list-scroll">
        {inTrash && list.length > 0 && <p className="small muted" style={{ padding: '10px 16px 0' }}>{ko.main.trashHint}</p>}
        {isIncident ? (
          <IncidentView />
        ) : compare ? (
          <CompareTable project={project} />
        ) : isToday && notes.length > 0 ? (
          <TodayView now={now} onDaily={() => void actions.today()} />
        ) : view === 'calendar' && !inTrash && !isToday ? (
          <CalendarView list={list} now={now} />
        ) : list.length === 0 ? (
          <div className="empty">
            <span>{notes.length === 0 && home ? ko.main.emptyList : ko.main.emptyFilter}</span>
            {notes.length === 0 && home ? (
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
      {sharing && <ShareDialog project={project} env={envFilter} onClose={() => setSharing(false)} />}
      <div className="fab-bar">
        <button type="button" className="btn btn-primary fab" onClick={() => void (keyScreen ? actions.newKey() : actions.newNote())}>+ {keyScreen ? ko.main.newKey : ko.main.newNote}</button>
      </div>
    </section>
  );
}

export function useBacklinks(id: string | null): Note[] {
  const notes = useApp((s) => s.notes);
  const idx = useMemo(() => backlinkIndex(notes), [notes]);
  return id ? (idx.get(id) ?? []) : [];
}
