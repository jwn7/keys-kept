import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { defaultKeyName, detectKey, isConflictCopy, isSecret, parseEnv, secretIssues, type Note, type SecretIssue } from '@vault/core';
import { KeyRow } from './KeyViews';
import { useApp } from '../app/store';
import { useLinks } from '../app/codeLink';
import { envFromFileName, issueCounts, projectSummaries, type ProjectSummary } from '../app/projectConfig';
import { markCapture } from '../app/metrics';
import { ui } from '../app/ui';
import { ko } from '../i18n/ko';
import { dayKey, displayTitle, pickFile, relTime, snippet } from '../app/util';
import { AlertIcon, ChevronIcon, FolderIcon, PlusIcon } from '../components/Icons';

const P = ko.projects;

// core가 충돌 사본 제목 끝에 붙이는 표식 `제목 (충돌 사본 — 기기 시각)`. 화면 문구가 아니라 저장된 제목의 형식이라 언어와 무관하게 이 글자다.
const CONFLICT_MARK = '(충돌 사본 — ';
/** 충돌 사본 제목에서 꼬리표(기기 이름과 시각)만 떼어 고른 언어로 보여 준다. */
function conflictFlag(title: string): string {
  return ko.sync.conflictFlag(title.slice(title.indexOf(CONFLICT_MARK) + CONFLICT_MARK.length, -1));
}

export const projectLabel = (name: string | null) => name ?? P.noProject;

/** 새 프로젝트: 이름만 정하고 빈 프로젝트 화면을 연다. 키를 하나 넣어야 목록에 남는다(프로젝트 = 키 항목의 폴더). */
export async function newProject(): Promise<void> {
  const name = (await ui.prompt({ title: P.newProject, label: P.newProjectLabel, confirmLabel: ko.common.confirm }))?.trim();
  if (name) useApp.getState().setFilter({ kind: 'project', project: name });
}

/** 끌어다 놓은 .env 파일을 읽어 넣기 창을 연다. 파일 이름에서 환경을 짐작한다(.env.production → prod). 파일은 이 기기 밖으로 나가지 않는다. */
export async function openEnvFile(file: File | undefined, project: string | null = null): Promise<void> {
  if (!file) return;
  const text = await file.text();
  useApp.getState().setEnvImport({ text, env: envFromFileName(file.name), project });
}

/** 파일을 끌어다 놓을 수 있는 영역. 놓는 동안 테두리로 알려 준다. */
function useDrop(project: string | null = null) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        void openEnvFile(e.dataTransfer.files[0], project);
      },
    },
  };
}

// ---------- 프로젝트 목록 (첫 화면) ----------

export function ProjectsView() {
  const notes = useApp((s) => s.notes);
  const lastProject = useApp((s) => s.lastProject);
  const setFilter = useApp((s) => s.setFilter);
  const links = useLinks((s) => s.links);
  const today = dayKey(new Date());
  const list = useMemo(() => {
    const all = projectSummaries(notes, today);
    // 마지막에 연 프로젝트를 맨 앞에
    const i = lastProject === undefined ? -1 : all.findIndex((p) => p.name === lastProject);
    return i > 0 ? [all[i]!, ...all.slice(0, i), ...all.slice(i + 1)] : all;
  }, [notes, today, lastProject]);
  const issues = useMemo(() => issueCounts(notes, today), [notes, today]);
  const drop = useDrop();

  if (notes.length === 0) return <EmptyVault />;
  return (
    <div className={`projects${drop.over ? ' drop-over' : ''}`} {...drop.props}>
      {issues.keys > 0 && <AttentionStrip keys={issues.keys} by={issues.by} />}
      <div className="project-grid">
        {list.map((p) => (
          <ProjectCard key={p.name ?? ''} p={p} linked={p.name !== null && !!links[p.name]} onOpen={() => setFilter({ kind: 'project', project: p.name })} />
        ))}
        <button type="button" className="project-card project-new desktop-only" onClick={() => void newProject()}>
          <PlusIcon />
          <span className="project-new-title">{P.newProject}</span>
          <span className="small muted">{P.newProjectHint}</span>
        </button>
      </div>
      <MobileMore />
    </div>
  );
}

/** 살펴볼 키가 있을 때만 프로젝트 목록 위에 뜨는 띠. 누르면 살펴볼 것으로 간다. */
function AttentionStrip({ keys, by }: { keys: number; by: Record<SecretIssue, number> }) {
  const setFilter = useApp((s) => s.setFilter);
  const parts = (Object.keys(P.stripParts) as SecretIssue[]).filter((k) => by[k] > 0).map((k) => P.stripParts[k](by[k]));
  return (
    <div className="attention-strip" role="status">
      <AlertIcon />
      <span className="attention-text">
        <strong>{P.strip(keys)}</strong>
        <span>{parts.join(', ')}</span>
      </span>
      <button type="button" className="btn-link" onClick={() => setFilter({ kind: 'attention' })}>{P.stripOpen}</button>
    </div>
  );
}

function ProjectCard({ p, linked, onOpen }: { p: ProjectSummary; linked: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="project-card" aria-label={P.open(projectLabel(p.name))} onClick={onOpen}>
      <span className="project-card-head">
        <FolderIcon />
        <span className="project-name">{projectLabel(p.name)}</span>
        <ChevronIcon />
      </span>
      <span className="project-envs">
        {p.envs.length ? p.envs.map((e) => <span key={e} className="key-chip line">{e}</span>) : <span className="small muted">{P.noEnv}</span>}
      </span>
      <span className="project-foot">
        <span>{P.keys(p.keys)}</span>
        {p.plain > 0 && <span>{P.plain(p.plain)}</span>}
        {linked && <span>{P.linked}</span>}
        {p.warnings > 0 && <span className="key-chip warn">{P.warnings(p.warnings)}</span>}
      </span>
    </button>
  );
}

/** 모바일에는 사이드바가 없어서 사고 모드·휴지통으로 가는 길을 목록 아래에 둔다. */
function MobileMore() {
  const setFilter = useApp((s) => s.setFilter);
  return (
    <div className="mobile-more mobile-only">
      <button type="button" className="btn-link muted" onClick={() => setFilter({ kind: 'incident' })}>{ko.main.incident}</button>
      <button type="button" className="btn-link muted" onClick={() => setFilter({ kind: 'trash' })}>{ko.main.trash}</button>
    </div>
  );
}

/** 빈 금고: 다음 행동 하나 = 쓰던 .env를 넣기 (끌어다 놓기, 파일 고르기, 붙여 넣기). */
function EmptyVault() {
  const drop = useDrop();
  return (
    <div className={`dropzone${drop.over ? ' drop-over' : ''}`} {...drop.props}>
      <FolderIcon />
      <h2>{drop.over ? P.dropHere : P.emptyTitle}</h2>
      <p>{P.emptyBody}</p>
      <div className="dropzone-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void pickFile('').then((f) => openEnvFile(f[0]))}>{P.pickFile}</button>
        <button type="button" className="btn btn-sm" onClick={() => useApp.getState().setEnvImport({ text: '' })}>{P.paste}</button>
      </div>
      <MobileMore />
    </div>
  );
}

// ---------- 살펴볼 것 ----------

/** 경고가 있는 키만 이유별로. 경고가 없으면 프로젝트 목록 위의 띠도 없다. */
export function AttentionView() {
  const notes = useApp((s) => s.notes);
  const today = dayKey(new Date());
  const v = useMemo(() => {
    const keyed = notes.filter(isSecret).map((n) => ({ n, issues: secretIssues(n, today) }));
    const pick = (want: SecretIssue[]) => keyed.filter((k) => k.issues.some((i) => want.includes(i))).map((k) => k.n);
    const expiry = pick(['expired', 'expiring']).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    return { exposed: pick(['public-name']), expiry, liveInDev: pick(['live-in-dev']), noPlace: keyed.filter((k) => k.n.secret.usedIn.length === 0).length, any: keyed.length > 0 };
  }, [notes, today]);
  const G = ko.keys.attentionGroups;
  const group = (label: string, list: (Note & { secret: NonNullable<Note['secret']> })[]): ReactNode =>
    list.length > 0 && (
      <section aria-label={label}>
        <h2 className="label group-label">{label}</h2>
        {list.map((n) => (
          <KeyRow key={n.id} n={n} showProject />
        ))}
      </section>
    );
  const empty = v.exposed.length + v.expiry.length + v.liveInDev.length === 0;
  return (
    <div className="attention">
      {empty && <p className="group-empty">{ko.keys.allClear}</p>}
      {group(G.exposed, v.exposed)}
      {group(G.expiry, v.expiry)}
      {group(G.liveInDev, v.liveInDev)}
      {v.noPlace > 0 && (
        <section aria-label={ko.keys.noPlace(v.noPlace)}>
          <h2 className="label group-label">{ko.keys.noPlace(v.noPlace)}</h2>
          <p className="group-empty">{ko.keys.noPlaceHint}</p>
        </section>
      )}
    </div>
  );
}

// ---------- 프로젝트의 키 ----------

/** 빠른 추가: `NAME=value` 한 줄 또는 알아볼 수 있는 키 값 → 이 프로젝트의 키. 여러 줄 .env를 붙여 넣으면 넣기 창. */
export function QuickAdd({ project }: { project: string | null }) {
  const app = useApp((s) => s.app);
  const [text, setText] = useState('');
  const [hint, setHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 잠금을 풀면 아무 것도 누르지 않고 바로 붙여 넣을 수 있게 (PC만. 모바일에서는 키보드가 화면을 가린다)
  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !useApp.getState().selectedId) inputRef.current?.focus();
  }, [project]);
  const add = async (open: boolean) => {
    const t = text.trim();
    if (!t) return;
    const pair = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=\S/.test(t) ? parseEnv(t)[0] : undefined;
    const bare = pair ? null : detectKey(t);
    const nameOnly = !pair && !bare && /^[A-Z_][A-Z0-9_]*$/.test(t); // 이름만: 값은 열어서 넣는다
    if (!pair && !bare && !nameOnly) {
      setHint(true);
      return;
    }
    setText('');
    setHint(false);
    markCapture('quick');
    const k = await app.session.save({
      title: pair ? pair.name : nameOnly ? t : defaultKeyName(bare!), // 환경변수로 쓸 수 있는 이름이어야 내보낼 때 빠지지 않는다
      folder: project,
      secret: { value: pair ? pair.value : nameOnly ? '' : t, env: useApp.getState().envFilter, usedIn: [] },
    });
    if (app.backendKind !== 'memory') app.scheduler.requestNow();
    // 추가한 키가 목록에 바로 나타나는 것이 피드백이다. 알림을 따로 띄우지 않는다.
    if (open || nameOnly) useApp.getState().select(k.id);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void add(e.shiftKey);
  };
  return (
    <div className="quick-wrap">
      <div className="quick-add">
        <span className="quick-plus" aria-hidden="true">+</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(false);
          }}
          onKeyDown={onKey}
          onPaste={(e) => {
            // 여러 줄짜리 .env를 붙여 넣으면 한 줄로 뭉개지 않고 넣기 창을 연다
            const pasted = e.clipboardData.getData('text');
            if (/\n/.test(pasted) && parseEnv(pasted).length >= 2) {
              e.preventDefault();
              useApp.getState().setEnvImport({ text: pasted, project });
            }
          }}
          placeholder={ko.quick.placeholder}
          aria-label={ko.quick.label}
          aria-describedby={hint ? 'quick-hint' : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        {text && (
          <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setText('')}>
            ×
          </button>
        )}
      </div>
      {hint && <p id="quick-hint" className="quick-hint">{ko.quick.notKey}</p>}
    </div>
  );
}

/** 프로젝트의 키는 이름순, 그 뒤에 키가 아닌 항목(예전 메모). 환경을 고르면 그 환경의 키와 공통 키만. */
export function projectItems(notes: Note[], project: string | null, env: string | null): Note[] {
  const mine = notes.filter((n) => n.folder === project && (!env || !n.secret || n.secret.env === null || n.secret.env === env));
  const byName = (a: Note, b: Note) => a.title.localeCompare(b.title, 'ko') || (a.secret?.env ?? '').localeCompare(b.secret?.env ?? '');
  return [...mine.filter(isSecret).sort(byName), ...mine.filter((n) => !isSecret(n)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))];
}

export function ProjectKeyList({ project }: { project: string | null }) {
  const notes = useApp((s) => s.notes);
  const envFilter = useApp((s) => s.envFilter);
  const list = useMemo(() => projectItems(notes, project, envFilter), [notes, project, envFilter]);
  const drop = useDrop(project);
  if (list.length === 0) {
    return (
      <div className={`empty${drop.over ? ' drop-over' : ''}`} {...drop.props}>
        <span>{P.emptyProject}</span>
        <span>{P.emptyProjectHint}</span>
        <button type="button" className="btn btn-sm" onClick={() => useApp.getState().setEnvImport({ text: '', project })}>{ko.keys.importOpen}</button>
      </div>
    );
  }
  return (
    <div className={drop.over ? 'drop-over' : undefined} {...drop.props}>
      {list.map((n) => (
        <NoteRow key={n.id} n={n} />
      ))}
    </div>
  );
}

/** 키 항목이면 키 줄로, 아니면 그냥 항목 줄로(예전 메모. 열어서 "키 항목으로 바꾸기"를 할 수 있다). */
export function NoteRow({ n, showProject }: { n: Note; showProject?: boolean }) {
  return isSecret(n) ? <KeyRow n={n} showProject={showProject} /> : <PlainRow n={n} showProject={showProject} />;
}

function PlainRow({ n, showProject }: { n: Note; showProject?: boolean | undefined }) {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  return (
    <button type="button" className="note-row" aria-current={n.id === selectedId ? 'true' : undefined} onClick={() => select(n.id)}>
      <div className="t">
        <span>{displayTitle(n)}</span>
        <time dateTime={n.updatedAt}>{relTime(n.updatedAt)}</time>
      </div>
      {(snippet(n.body) || showProject) && <div className="s">{showProject ? projectLabel(n.folder) : snippet(n.body)}</div>}
      {isConflictCopy(n) && (
        <div className="row-meta">
          <span className="conflict-flag">{conflictFlag(n.title)}</span>
        </div>
      )}
    </button>
  );
}
