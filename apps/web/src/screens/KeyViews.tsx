import { useEffect, useMemo, useRef, useState } from 'react';
import { detectKey, envAgeFileName, formatEnv, envForProject, sealEnv, isSecret, maskValue, parseEnv, placesUsed, planEnvImport, publicNameWarning, secretIssues, type KeyDetection, type Note, type SecretInfo, type SecretIssue } from '@vault/core';
import { useApp } from '../app/store';
import { ui } from '../app/ui';
import { ko } from '../i18n/ko';
import { dayKey, downloadBytes, formatDay } from '../app/util';
import { CopyIcon } from '../components/Icons';

const K = ko.keys;

// ---------- 복사 ----------

let clearTimer: ReturnType<typeof setTimeout> | null = null;
const CLEAR_AFTER_MS = 30_000;

/**
 * 값을 클립보드에 넣고, 30초 뒤에도 클립보드가 그 값 그대로면 비운다.
 * 그 사이에 다른 것을 복사했으면 건드리지 않는다. 브라우저가 클립보드 읽기를 허락하지 않으면 확인할 수 없으므로 비우지 않는다.
 */
export async function copySecret(text: string, message: string = K.copied): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ui.toast(K.copyFailed);
    return;
  }
  ui.toast(message);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    void navigator.clipboard
      .readText()
      .then((cur) => (cur === text ? navigator.clipboard.writeText('') : undefined))
      .catch(() => undefined);
  }, CLEAR_AFTER_MS);
}

/** 프로젝트에 있는 환경 이름들 (dev, prod …). */
export function envsOf(notes: Note[], project: string | null): string[] {
  const s = new Set<string>();
  for (const n of notes) if (isSecret(n) && n.folder === project && n.secret.env) s.add(n.secret.env);
  return [...s].sort();
}

/** 프로젝트 하나를 .env 글로. 환경이 여럿인데 고르지 않았으면 물어본다. null을 돌려주면 취소. */
export async function projectEnvText(notes: Note[], project: string | null, env: string | null): Promise<{ text: string; env: string | null } | null> {
  const envs = envsOf(notes, project);
  let chosen = env;
  if (chosen === null && envs.length > 0) {
    const answer = await ui.prompt({ title: K.pickEnv, label: K.env, initial: envs[0], suggestions: envs, confirmLabel: ko.common.confirm, allowEmpty: true });
    if (answer === null) return null;
    chosen = answer.trim() || null;
  }
  return { text: formatEnv(envForProject(notes, { project, env: chosen })), env: chosen };
}

// ---------- 표시 ----------

function kindLabel(d: KeyDetection | null): string {
  return d ? `${d.provider} · ${d.kind}` : K.unknownKind;
}

function IssueChip({ issue, date, today }: { issue: SecretIssue; date?: string | null | undefined; today: string }) {
  const days = date ? Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000) : 0;
  const text = issue === 'expired' ? K.issue.expired : issue === 'expiring' ? K.issue.expiring(days) : K.issue[issue];
  return <span className="key-chip warn">{text}</span>;
}

/** 목록의 한 줄: 이름, 어느 서비스의 키인지, 가린 값, 살펴볼 것, 복사 단추. */
export function KeyRow({ n }: { n: Note & { secret: SecretInfo } }) {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const today = dayKey(new Date());
  const d = useMemo(() => detectKey(n.secret.value), [n.secret.value]);
  const issues = secretIssues(n, today);
  return (
    <div className="note-row key-row" aria-current={n.id === selectedId ? 'true' : undefined}>
      <button type="button" className="key-main" onClick={() => select(n.id)}>
        <span className="key-name">
          <span>{n.title || K.unnamed}</span>
          {n.secret.env && <span className="key-chip line">{n.secret.env}</span>}
        </span>
        <span className="key-sub">
          <span>{d ? d.provider : K.unknownKind}</span>
          <span className="key-mask">{maskValue(n.secret.value) || K.noValue}</span>
          {d?.exposure === 'public' && <span className="key-chip ok">{K.publicOk}</span>}
          {issues.map((i) => (
            <IssueChip key={i} issue={i} date={n.date} today={today} />
          ))}
        </span>
      </button>
      <button type="button" className="key-copy" aria-label={K.copyOf(n.title || K.unnamed)} title={K.copy} disabled={!n.secret.value} onClick={() => void copySecret(n.secret.value)}>
        <CopyIcon />
      </button>
    </div>
  );
}

// ---------- 키 상세 ----------

/**
 * 편집기 안의 키 칸: 값(가려서, 보기·복사), 환경, 쓰이는 곳. 이름은 편집기의 제목 칸, 만료일은 날짜 칩, 설명은 본문이다.
 * 값은 입력을 멈추고 0.6초 뒤, 또는 칸을 벗어날 때 저장한다.
 */
export function SecretPanel({ note }: { note: Note & { secret: SecretInfo } }) {
  const app = useApp((s) => s.app);
  const notes = useApp((s) => s.notes);
  const [value, setValue] = useState(note.secret.value);
  const [env, setEnv] = useState(note.secret.env ?? '');
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ note, value, env });
  latest.current = { note, value, env };

  // 다른 키로 바꾸면 그 키의 값으로, 다시 가린다
  useEffect(() => {
    setValue(note.secret.value);
    setEnv(note.secret.env ?? '');
    setShow(false);
  }, [note.id]);

  const save = (patch: Partial<SecretInfo>) => {
    const cur = latest.current.note;
    if (!cur.secret) return;
    void app.session.save({ id: cur.id, secret: { ...cur.secret, ...patch } });
    if (app.backendKind !== 'memory') app.scheduler.requestNow();
  };
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { note: cur, value: v, env: e } = latest.current;
    const nextEnv = e.trim() || null;
    if (cur.secret && (cur.secret.value !== v || cur.secret.env !== nextEnv)) save({ value: v, env: nextEnv });
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  useEffect(() => () => flush(), [note.id]); // 다른 키로 가거나 닫을 때 남은 입력을 저장

  const today = dayKey(new Date());
  const d = useMemo(() => detectKey(value), [value]);
  const issues = secretIssues({ ...note, secret: { ...note.secret, value, env: env.trim() || null } }, today);
  const envs = useMemo(() => [...new Set(['dev', 'prod', ...envsOf(notes, note.folder)])], [notes, note.folder]);
  const places = useMemo(() => placesUsed(notes).map((p) => p.place), [notes]);

  const addPlace = async () => {
    const p = await ui.prompt({ title: K.usedIn, label: K.placeLabel, suggestions: [...new Set([app.deviceName, ...places])].filter((x) => !note.secret.usedIn.includes(x)), confirmLabel: K.add });
    const name = p?.trim();
    if (name && !note.secret.usedIn.includes(name)) save({ usedIn: [...note.secret.usedIn, name] });
  };

  return (
    <div className="secret-panel">
      <div className="secret-kind">
        <span className="key-chip">{kindLabel(d)}</span>
        {d?.mode && <span className={`key-chip${d.mode === 'live' ? ' warn' : ''}`}>{K.mode[d.mode]}</span>}
        {d?.exposure === 'public' && <span className="key-chip ok">{K.publicOk}</span>}
        {d?.rotateUrl && (
          <a href={d.rotateUrl} target="_blank" rel="noopener noreferrer" className="rotate-link">{K.rotate}</a>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="secret-issues">
          {issues.map((i) => (
            <li key={i}>{i === 'expiring' || i === 'expired' ? K.issueLong[i](note.date ? formatDay(note.date) : '') : K.issueLong[i]}</li>
          ))}
        </ul>
      )}
      <div className="field">
        <label htmlFor="secret-value">{K.value}</label>
        <div className="secret-value">
          <input
            id="secret-value"
            type={show ? 'text' : 'password'}
            value={value}
            autoComplete="off"
            spellCheck={false}
            placeholder={K.valuePlaceholder}
            onChange={(e) => {
              setValue(e.target.value);
              schedule();
            }}
            onBlur={flush}
          />
          <button type="button" className="btn btn-sm" aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? ko.common.hide : ko.common.show}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!value} onClick={() => void copySecret(value)}>{K.copy}</button>
        </div>
      </div>
      <div className="secret-grid">
        <div className="field">
          <label htmlFor="secret-env">{K.env}</label>
          <input
            id="secret-env"
            className="secret-env"
            list="secret-envs"
            value={env}
            placeholder={K.envCommon}
            onChange={(e) => {
              setEnv(e.target.value);
              schedule();
            }}
            onBlur={flush}
          />
          <datalist id="secret-envs">
            {envs.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <span className="field-label">{K.usedIn}</span>
          <div className="secret-places">
            {note.secret.usedIn.map((p) => (
              <span key={p} className="chip">
                {p}
                <button type="button" className="chip-x" aria-label={K.removePlace(p)} onClick={() => save({ usedIn: note.secret.usedIn.filter((x) => x !== p) })}>×</button>
              </span>
            ))}
            <button type="button" className="chip chip-add" onClick={() => void addPlace()}>+ {K.add}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- .env 넣기 ----------

/** 붙여 넣은 .env를 항목으로 나눠 보여주고, 확인하면 장부에 넣는다. 같은 이름은 값만 고친다. */
export function EnvImportDialog({ initialText, project: initialProject, onClose }: { initialText: string; project: string | null; onClose: () => void }) {
  const app = useApp((s) => s.app);
  const notes = useApp((s) => s.notes);
  const [text, setText] = useState(initialText);
  const [project, setProject] = useState(initialProject ?? '');
  const [env, setEnv] = useState('');
  const [busy, setBusy] = useState(false);
  const scope = { project: project.trim() || null, env: env.trim() || null };
  const entries = useMemo(() => parseEnv(text), [text]);
  const plan = useMemo(() => planEnvImport(notes, entries, scope), [notes, entries, scope.project, scope.env]);
  const willChange = plan.create.length + plan.update.length;
  const projects = useMemo(() => [...new Set(notes.map((n) => n.folder).filter((f): f is string => !!f))].sort(), [notes]);
  const stateOf = (name: string) => (plan.create.some((c) => c.title === name) ? 'new' : plan.update.some((u) => notes.find((n) => n.id === u.id)?.title === name) ? 'changed' : 'same');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async () => {
    setBusy(true);
    try {
      for (const input of [...plan.create, ...plan.update]) await app.session.save(input);
      if (app.backendKind !== 'memory') app.scheduler.requestNow();
      ui.toast(K.imported(plan.create.length, plan.update.length));
      if (scope.project) useApp.getState().setFilter({ kind: 'folder', folder: scope.project });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay center" onClick={onClose}>
      <div className="dialog env-dialog" role="dialog" aria-label={K.importTitle} onClick={(e) => e.stopPropagation()}>
        <h2>{K.importTitle}</h2>
        <div className="env-scope">
          <label className="field">
            <span className="field-label">{K.project}</span>
            <input className="secret-env" list="env-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder={K.projectPlaceholder} />
            <datalist id="env-projects">
              {projects.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">{K.env}</span>
            <input className="secret-env" list="env-envs" value={env} onChange={(e) => setEnv(e.target.value)} placeholder={K.envCommon} />
            <datalist id="env-envs">
              <option value="dev" />
              <option value="prod" />
            </datalist>
          </label>
        </div>
        <div className="env-cols">
          <textarea className="plain" aria-label={K.importPaste} placeholder={K.importPaste} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="env-preview" aria-live="polite">
            <div className="label">{K.found(entries.length)}</div>
            {entries.map((e, i) => {
              const d = detectKey(e.value);
              const st = stateOf(e.name);
              return (
                <div key={`${e.name}-${i}`} className="env-row">
                  <span className="key-name">{e.name}</span>
                  <span className="key-sub">{d ? d.provider : K.unknownKind}</span>
                  {publicNameWarning(e.name, e.value) ? <span className="key-chip warn">{K.issue['public-name']}</span> : <span className={`key-chip${st === 'new' ? ' ok' : ''}`}>{K.importState[st]}</span>}
                </div>
              );
            })}
            {entries.some((e) => publicNameWarning(e.name, e.value)) && <p className="small env-warn">{K.issueLong['public-name']}</p>}
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={onClose}>{ko.common.cancel}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || willChange === 0} onClick={() => void run()}>{K.importRun(willChange)}</button>
        </div>
      </div>
    </div>
  );
}

/** 프로젝트의 값을 암호화된 .env.age(표준 age)로 내려받는다. 평문 파일을 남기지 않고 vault-run 이 풀어 쓴다. */
export async function downloadSealedEnv(notes: Note[], project: string | null, env: string | null): Promise<void> {
  const envs = envsOf(notes, project);
  let chosen = env;
  if (chosen === null && envs.length > 0) {
    const answer = await ui.prompt({ title: K.pickEnv, label: K.env, initial: envs[0], suggestions: envs, confirmLabel: ko.common.confirm, allowEmpty: true });
    if (answer === null) return;
    chosen = answer.trim() || null;
  }
  const pass = await ui.prompt({ title: K.sealedTitle, body: K.sealedBody, label: K.sealedPass, password: true, confirmLabel: K.download });
  if (!pass) return;
  const name = envAgeFileName(chosen);
  downloadBytes(name, await sealEnv(envForProject(notes, { project, env: chosen }), pass));
  ui.toast(K.sealedDone(name));
}

/** 프로젝트의 .env를 파일로 내려받는다. 평문 파일이 디스크에 생기므로 먼저 확인받는다. */
export async function downloadProjectEnv(notes: Note[], project: string | null, env: string | null): Promise<void> {
  const r = await projectEnvText(notes, project, env);
  if (!r) return;
  const ok = await ui.confirm({ title: K.downloadTitle, body: K.downloadWarn, confirmLabel: K.download, danger: true });
  if (!ok) return;
  downloadBytes(r.env ? `.env.${r.env}` : '.env', new TextEncoder().encode(r.text));
}
