import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { envForProject, isSecret } from '@vault/core';
import { CompareTable, copySecret, downloadProjectEnv, downloadSealedEnv, ExportMenu, IncidentView, ShareDialog, EnvImportDialog, projectEnvText } from './KeyViews';
import { flushEditor, lockNow, useApp, type AppState, type Filter } from '../app/store';
import { ko } from '../i18n/ko';
import { dayKey } from '../app/util';
import { envsOf, issueCounts, projectSummaries } from '../app/projectConfig';
import { markCapture } from '../app/metrics';
import { StatusBadge } from '../components/StatusBadge';
import { AlertIcon, BackIcon, FolderIcon, GearIcon, GridIcon, LockIcon, PlusIcon, SearchIcon, TodayIcon, TrashIcon } from '../components/Icons';
import { AttentionView, NoteRow, ProjectKeyList, ProjectsView, QuickAdd, newProject, projectLabel } from './ProjectViews';
import { ConnectView } from './ConnectView';
import { Logo } from '../components/Seal';
import { Editor } from './Editor';
import { CommandPalette } from './CommandPalette';

/** 지금 보고 있는 프로젝트 (프로젝트 화면이 아니면 undefined) */
export const currentProject = (f: Filter): string | null | undefined => (f.kind === 'project' ? f.project : undefined);

/**
 * 가운데 열을 넓게 쓰는 화면: 프로젝트 목록, 연결 탭, 환경 비교표.
 * 이때 편집기는 고른 키가 있을 때만 오른쪽에 열린다.
 */
export function isWide(s: Pick<AppState, 'filter' | 'projectTab' | 'projectView'>): boolean {
  return s.filter.kind === 'projects' || (s.filter.kind === 'project' && (s.projectTab === 'connect' || s.projectView === 'compare'));
}

/** 새 키 / 잠금 / 동기화 — 팔레트·단축키·단추가 같이 쓴다 */
export function useActions() {
  const app = useApp((s) => s.app);
  return {
    /** 빈 키 항목을 만들어 연다. 프로젝트 화면이면 그 프로젝트에, 환경을 골라 뒀으면 그 환경으로. */
    async newKey() {
      const { filter, envFilter, setFilter, setProjectTab, select } = useApp.getState();
      const project = currentProject(filter) ?? null;
      markCapture('new');
      const n = await app.session.save({ title: '', folder: project, secret: { value: '', env: filter.kind === 'project' ? envFilter : null, usedIn: [] } });
      if (filter.kind !== 'project' || filter.project !== project) setFilter({ kind: 'project', project });
      setProjectTab('keys');
      select(n.id);
      return n;
    },
    importEnv() {
      const { filter, setEnvImport } = useApp.getState();
      setEnvImport({ text: '', project: currentProject(filter) ?? null });
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
  const filter = useApp((s) => s.filter);
  const wide = useApp(isWide);
  const actions = useActions();

  // 전역 단축키 (SPEC §2.3)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // 브라우저 탭에서는 Ctrl+N이 새 창으로 가로채인다. Alt+N은 어디서나 동작한다.
      if (e.altKey && !e.ctrlKey && !e.metaKey && k === 'n') {
        e.preventDefault();
        void actions.newKey();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (k === 'k') {
        e.preventDefault();
        setPalette(!useApp.getState().paletteOpen);
      } else if (k === 'l') {
        e.preventDefault();
        actions.lock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // 마운트 시 1회

  // 앱 아이콘 바로가기(/?action=new): 잠금을 푼 뒤 한 번 실행하고 주소에서 지운다
  useEffect(() => {
    const action = new URLSearchParams(window.location.search).get('action');
    if (!action) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (action === 'new') void actions.newKey();
  }, []); // 마운트 시 1회

  // 모바일 상단 바: 왼쪽은 이동(뒤로 + 목적지 이름), 오른쪽은 이 화면의 작업 (DESIGN.md 모바일 상단 바)
  const mobileEditing = mobileView === 'editor' && !!selectedId;
  const project = currentProject(filter);

  return (
    <div className="main">
      {/* 모바일 전용 상단 바. PC에는 가로 바가 없다: 내비게이션이 내용보다 튀지 않게 사이드바로 모았다. */}
      <header className="topbar mobile-only">
        <div className="left">
          {mobileEditing ? (
            <button type="button" className="back-btn" aria-label={ko.main.backToList} onClick={() => useApp.getState().setMobileView('list')}>
              <BackIcon />
              {project !== undefined ? projectLabel(project) : ko.main.backToListShort}
            </button>
          ) : filter.kind !== 'projects' ? (
            <button type="button" className="back-btn" aria-label={ko.main.backToProjects} onClick={() => useApp.getState().setFilter({ kind: 'projects' })}>
              <BackIcon />
              {ko.main.backToProjectsShort}
            </button>
          ) : (
            <StatusBadge status={status} local={app.backendKind === 'memory'} compact />
          )}
        </div>
        <div className="right">
          {!mobileEditing && (
            <button type="button" className="search-btn" onClick={() => setPalette(true)} aria-label={ko.main.search}>
              <SearchIcon />
              <span>{ko.main.search}</span>
            </button>
          )}
          {/* 왼쪽은 이동, 오른쪽 `완료`는 이 화면의 작업(키보드 내리고 저장). 같은 곳으로 가는 버튼을 두 개 두지 않는다. */}
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
      <div className="columns" data-view={mobileView} data-mode={wide ? 'wide' : 'list'} data-selected={selectedId ? 'true' : 'false'}>
        <Sidebar />
        <Center />
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
  return <EnvImportDialog initialText={envImport.text} project={envImport.project !== undefined ? envImport.project : (currentProject(filter) ?? null)} env={envImport.env} onClose={() => useApp.getState().setEnvImport(null)} />;
}

function Sidebar() {
  const app = useApp((s) => s.app);
  const status = useApp((s) => s.status);
  const notes = useApp((s) => s.notes);
  const trash = useApp((s) => s.trash);
  const setScreen = useApp((s) => s.setScreen);
  const setPalette = useApp((s) => s.setPalette);
  const actions = useActions();
  const today = dayKey(new Date());
  const projects = useMemo(() => projectSummaries(notes, today), [notes, today]);
  const attention = useMemo(() => issueCounts(notes, today).keys, [notes, today]);
  return (
    <nav className="sidebar" aria-label={ko.main.projects}>
      <div className="side-head">
        <Logo />
      </div>
      <button type="button" className="side-search" onClick={() => setPalette(true)}>
        <SearchIcon />
        <span>{ko.main.search}</span>
        <kbd>Ctrl K</kbd>
      </button>
      <Item f={{ kind: 'projects' }} label={ko.main.allProjects} count={projects.length || undefined} icon={<GridIcon />} />
      <Item f={{ kind: 'attention' }} label={ko.main.attention} count={attention || undefined} icon={<TodayIcon />} />
      <div className="label">{ko.main.projects}</div>
      {projects.length === 0 && <div className="side-empty">{ko.main.noProjectsYet}</div>}
      {projects.map((p) => (
        <Item key={p.name ?? ''} f={{ kind: 'project', project: p.name }} label={projectLabel(p.name)} count={p.keys + p.plain} icon={<FolderIcon />} />
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

/** 가운데 열: 고른 화면의 제목줄과 내용 */
function Center() {
  const filter = useApp((s) => s.filter);
  const notes = useApp((s) => s.notes);
  const setScreen = useApp((s) => s.setScreen);
  const actions = useActions();
  const project = currentProject(filter);
  const title =
    filter.kind === 'project' ? projectLabel(filter.project) : filter.kind === 'trash' ? ko.main.trash : filter.kind === 'attention' ? ko.main.attention : filter.kind === 'incident' ? ko.main.incident : ko.projects.title;
  const onProjects = filter.kind === 'projects';

  return (
    <section className="list" aria-label={title}>
      <div className="list-top">
        <div className="list-title-row">
          <h1 className="list-title">{title}</h1>
          {onProjects && <button type="button" className="btn btn-sm mobile-only" onClick={() => setScreen('settings')}>{ko.main.settings}</button>}
          {onProjects && notes.length > 0 && (
            <button type="button" className="btn btn-sm desktop-only" onClick={() => actions.importEnv()}>{ko.keys.importOpen}</button>
          )}
          {onProjects && (
            <button type="button" className={`btn btn-sm desktop-only${notes.length > 0 ? ' btn-primary' : ''}`} onClick={() => void newProject()}>
              <PlusIcon />
              {ko.projects.newProject}
            </button>
          )}
          {project !== undefined && (
            <button type="button" className="btn btn-primary btn-sm desktop-only" onClick={() => void actions.newKey()} title="Alt+N">
              <PlusIcon />
              {ko.main.newKey}
            </button>
          )}
        </div>
        {project !== undefined && <ProjectHead project={project} />}
      </div>
      <div className="list-scroll">
        {filter.kind === 'projects' ? (
          <ProjectsView />
        ) : filter.kind === 'attention' ? (
          <AttentionView />
        ) : filter.kind === 'incident' ? (
          <IncidentView />
        ) : filter.kind === 'trash' ? (
          <TrashList />
        ) : (
          <ProjectBody project={filter.project} />
        )}
      </div>
      {(onProjects || project !== undefined) && (
        <div className="fab-bar">
          <button type="button" className="btn btn-primary fab" onClick={() => void (onProjects ? newProject() : actions.newKey())}>
            + {onProjects ? ko.projects.newProject : ko.main.newKey}
          </button>
        </div>
      )}
    </section>
  );
}

function TrashList() {
  const trash = useApp((s) => s.trash);
  const list = useMemo(() => [...trash].sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')), [trash]);
  if (list.length === 0) return <div className="empty">{ko.main.emptyTrash}</div>;
  return (
    <>
      <p className="small muted list-note">{ko.main.trashHint}</p>
      {list.map((n) => (
        <NoteRow key={n.id} n={n} showProject />
      ))}
    </>
  );
}

/** 프로젝트 화면 머리: 탭(키 / 연결), 키 탭이면 빠른 추가와 환경·보기·넣기·꺼내기 */
function ProjectHead({ project }: { project: string | null }) {
  const notes = useApp((s) => s.notes);
  const tab = useApp((s) => s.projectTab);
  const setTab = useApp((s) => s.setProjectTab);
  const view = useApp((s) => s.projectView);
  const setView = useApp((s) => s.setProjectView);
  const envFilter = useApp((s) => s.envFilter);
  const setEnvFilter = useApp((s) => s.setEnvFilter);
  const actions = useActions();
  const envs = useMemo(() => envsOf(notes, project), [notes, project]);
  const keyCount = useMemo(() => notes.filter((n) => n.folder === project && isSecret(n)).length, [notes, project]);
  const hasKeys = keyCount > 0;
  const [sharing, setSharing] = useState(false);
  const copyEnv = async () => {
    const r = await projectEnvText(notes, project, envFilter);
    if (r) await copySecret(r.text, ko.keys.copiedEnv(envForProject(notes, { project, env: r.env }).length));
  };
  const P = ko.projects;
  return (
    <>
      {/* 연결은 이름 있는 프로젝트만 (.vault.yml의 project가 이름이다) */}
      <div className="tabs" role="tablist" aria-label={P.tabs}>
        <button type="button" role="tab" aria-selected={tab === 'keys'} onClick={() => setTab('keys')}>{P.tabKeys(keyCount)}</button>
        {project !== null && (
          <button type="button" role="tab" aria-selected={tab === 'connect'} onClick={() => setTab('connect')}>{P.tabConnect}</button>
        )}
      </div>
      {tab === 'keys' && (
        <>
          <QuickAdd project={project} />
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
              <div className="segment" role="group" aria-label={P.viewLabel}>
                <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>{P.viewList}</button>
                <button type="button" aria-pressed={view === 'compare'} onClick={() => setView('compare')}>{P.viewCompare}</button>
              </div>
            )}
            <span className="env-bar-gap" />
            <button type="button" className="btn-link" onClick={() => actions.importEnv()}>{ko.keys.importOpen}</button>
            {hasKeys && (
              <ExportMenu
                onCopy={() => void copyEnv()}
                onSealed={() => void downloadSealedEnv(notes, project, envFilter)}
                onShare={() => setSharing(true)}
                onPlain={() => void downloadProjectEnv(notes, project, envFilter)}
              />
            )}
          </div>
        </>
      )}
      {sharing && <ShareDialog project={project} env={envFilter} onClose={() => setSharing(false)} />}
    </>
  );
}

function ProjectBody({ project }: { project: string | null }) {
  const tab = useApp((s) => s.projectTab);
  const view = useApp((s) => s.projectView);
  const notes = useApp((s) => s.notes);
  const hasEnvs = useMemo(() => envsOf(notes, project).length > 0, [notes, project]);
  if (tab === 'connect' && project !== null) return <ConnectView project={project} />;
  if (view === 'compare' && hasEnvs) return <CompareTable project={project} />;
  return <ProjectKeyList project={project} />;
}
