import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSecret } from '@vault/core';
import { useApp } from '../app/store';
import { ui } from '../app/ui';
import { codeLinkSupported, inspectFolder, keyFilesFor, pickCodeFolder, regrantCodeFolder, setFilePassphrase, unlinkCodeFolder, useLinks, writeGitignore, writeKeyFiles, writeVaultYml, type FolderInfo } from '../app/codeLink';
import { strongEnough } from '../app/strength';
import { appendGitignore, buildVaultYml, envStyleNames, envsOf, gitignoreMissing, missingRequired, setVaultYmlAi } from '../app/projectConfig';
import { markCapture } from '../app/metrics';
import { relTime } from '../app/util';
import { ko } from '../i18n/ko';
import { CopyIcon } from '../components/Icons';

const C = ko.connect;

/**
 * 프로젝트 화면의 "연결" 탭 (docs/STRATEGY.md 계획 15, 캔버스 4-1·4-2).
 * 코드 폴더(키 파일과 .vault.yml), 필요한 키, AI 도구(MCP) 연결, 최근에 AI가 쓴 키.
 * 폴더에 쓰는 것은 암호화된 `.env.<환경>.age`와 값이 없는 `.vault.yml`뿐이다.
 */
export function ConnectView({ project }: { project: string }) {
  const app = useApp((s) => s.app);
  const notes = useApp((s) => s.notes);
  const link = useLinks((s) => s.links[project]);
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const envs = useMemo(() => envsOf(notes, project), [notes, project]);
  const files = useMemo(() => keyFilesFor(notes, project).map((f) => f.name), [notes, project]);
  const filesKey = files.join(',');

  const reload = useCallback(async () => {
    setInfo(link ? await inspectFolder(project, filesKey.split(',')) : null);
  }, [project, link?.folder, link?.permission, link?.lastWrite?.at, filesKey]);
  useEffect(() => {
    void reload();
    // 다른 창(편집기, 터미널)에서 .vault.yml을 고치거나 AI가 기록을 남기고 돌아오면 다시 읽는다
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const write = async () => {
    setBusy(true);
    try {
      const r = await writeKeyFiles(app, useApp.getState().notes, project, true);
      ui.toast(r === 'done' ? C.written(files.length) : r === 'no-pass' ? C.passNeeded : r === 'needs-permission' ? C.needsPermission : C.writeFailed);
    } finally {
      setBusy(false);
    }
  };
  const setPass = async () => {
    const pass = await ui.prompt({ title: C.passTitle, body: C.passBody, label: C.passLabel, password: true, confirmLabel: ko.common.save });
    if (!pass) return;
    // 키 파일이 새면 남는 방어는 이 비밀번호뿐이다 (오프라인으로 얼마든지 맞혀 볼 수 있다)
    if (!(await strongEnough(pass))) return ui.toast(ko.keys.weakFilePass);
    await setFilePassphrase(app, project, pass);
    await write();
  };
  const pick = async () => {
    const name = await pickCodeFolder(app, project);
    if (name && useLinks.getState().links[project]?.hasPass) await write();
  };
  const createYml = async () => {
    if (await writeVaultYml(project, buildVaultYml(project, envs, envStyleNames(notes, project)))) {
      ui.toast(C.ymlCreated);
      await reload();
    }
  };
  const ignoreKeyFiles = async () => {
    if (!info) return;
    if (await writeGitignore(project, appendGitignore(info.gitignore, gitignoreMissing(info.gitignore)))) {
      ui.toast(C.gitignoreAdded);
      await reload();
    }
  };
  const setAi = async (on: boolean) => {
    if (info?.ymlText == null) return;
    if (await writeVaultYml(project, setVaultYmlAi(info.ymlText, on))) await reload();
  };
  /** 빠진 키를 그 환경에 그 이름으로 만들고 키 탭에서 연다 */
  const addMissing = async (name: string, env: string | null) => {
    markCapture('new');
    const n = await app.session.save({ title: name, folder: project, secret: { value: '', env, usedIn: [] } });
    const s = useApp.getState();
    s.setProjectTab('keys');
    s.select(n.id);
  };

  if (!codeLinkSupported()) {
    return (
      <div className="connect">
        <section className="connect-card">
          <h2>{C.folderTitle}</h2>
          <p className="small muted">{C.unsupported}</p>
        </section>
        <AiCard project={project} info={null} onToggle={setAi} />
      </div>
    );
  }

  const required = info?.yml?.required ?? [];
  const baseEnv = info?.branchEnv ?? (envs.includes('dev') ? 'dev' : (envs[0] ?? null));
  const envList = envs.length ? [...(baseEnv ? [baseEnv] : []), ...envs.filter((e) => e !== baseEnv)] : [null];
  const missing = envList.flatMap((env) => missingRequired(notes, project, env, required).map((name) => ({ name, env })));
  const baseMissing = missing.filter((m) => m.env === (envs.length ? baseEnv : null)).length;

  return (
    <div className="connect">
      <div className="connect-col">
        <section className="connect-card" aria-label={C.folderTitle}>
          <h2>{C.folderTitle}</h2>
          {!link ? (
            <>
              <p className="small muted">{C.intro}</p>
              <div className="connect-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void pick()}>{C.pick}</button>
              </div>
            </>
          ) : (
            <>
              <dl className="connect-facts">
                <dt>{C.folder}</dt>
                <dd className="mono">{link.folder}</dd>
                <dt>{C.ymlLabel}</dt>
                <dd>
                  <span className="mono">.vault.yml</span> <span className={info?.ymlText != null ? 'ok-text' : 'muted'}>{info?.ymlText != null ? C.found : C.notFound}</span>
                </dd>
                <dt>{C.branch}</dt>
                <dd className="mono">{info?.branch ? (info.branchEnv ? `${info.branch} → ${info.branchEnv}` : info.branch) : <span className="muted">{C.noBranch}</span>}</dd>
                <dt>{C.keyFiles}</dt>
                <dd className="mono">{info?.files.length ? info.files.join(', ') : <span className="muted">{C.notWritten}</span>}</dd>
              </dl>
              {link.permission !== 'granted' ? (
                <div className="connect-warn">
                  <p className="small">{C.needsPermission}</p>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void regrantCodeFolder(project)}>{C.regrant}</button>
                </div>
              ) : (
                <>
                  {info?.isGit && gitignoreMissing(info.gitignore).length > 0 && (
                    <div className="connect-warn" role="status">
                      <p className="small">{C.gitignoreWarn(gitignoreMissing(info.gitignore).join(', '))}</p>
                      <button type="button" className="btn btn-sm" onClick={() => void ignoreKeyFiles()}>{C.gitignoreAdd}</button>
                    </div>
                  )}
                  <p className="small muted">{link.hasPass ? C.autoWrite : C.passNeeded}</p>
                  {link.error && <p className="small danger-text">{C.writeFailed}</p>}
                  <div className="connect-actions">
                    {link.hasPass ? (
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void write()}>{C.writeNow}</button>
                    ) : (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void setPass()}>{C.passSet}</button>
                    )}
                    {link.hasPass && <button type="button" className="btn btn-sm" onClick={() => void setPass()}>{C.passChange}</button>}
                    <button type="button" className="btn btn-sm" onClick={() => void pick()}>{C.change}</button>
                    {link.lastWrite && <span className="small muted">{C.writtenAt(relTime(link.lastWrite.at))}</span>}
                    <button type="button" className="btn-link muted connect-unlink" onClick={() => void unlinkCodeFolder(project)}>{C.unlink}</button>
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {link && info && (
          <section className="connect-card" aria-label={C.yml}>
            <h2 className="mono">{C.yml}</h2>
            {info.ymlText != null ? (
              <>
                {info.yml?.project && info.yml.project !== project && <p className="small warn-text">{C.ymlOther(info.yml.project)}</p>}
                <pre className="connect-yml">{info.ymlText}</pre>
                <p className="small muted">{C.ymlHint}</p>
              </>
            ) : (
              <>
                <p className="small muted">{C.ymlMissing}</p>
                <div className="connect-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void createYml()}>{C.ymlCreate}</button>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      <div className="connect-col">
        {link && info && (
          <section className="connect-card" aria-label={C.required}>
            <h2>{C.required}</h2>
            {required.length === 0 ? (
              <p className="small muted">{C.requiredNone}</p>
            ) : (
              <>
                <p className="connect-count">
                  <strong>
                    {required.length - baseMissing} / {required.length}
                  </strong>
                  {baseEnv && <span className="small muted">{C.requiredBasis(baseEnv)}</span>}
                </p>
                {missing.length === 0 && <p className="small muted">{C.requiredAll}</p>}
                {missing.map((m) => (
                  <div key={`${m.env ?? ''}:${m.name}`} className="connect-row">
                    <span className="mono strong">{m.name}</span>
                    <span className="key-chip warn">{m.env ? C.missingIn(m.env) : C.missingAll}</span>
                    <button type="button" className="btn btn-sm" aria-label={C.addLabel(m.name, m.env ?? ko.keys.envCommon)} onClick={() => void addMissing(m.name, m.env)}>{C.add}</button>
                  </div>
                ))}
              </>
            )}
          </section>
        )}
        <AiCard project={project} info={link ? info : null} onToggle={setAi} />
        {link && info && <AiLog project={project} info={info} />}
      </div>
    </div>
  );
}

function AiCard({ project, info, onToggle }: { project: string; info: FolderInfo | null; onToggle: (on: boolean) => void }) {
  const notes = useApp((s) => s.notes);
  const names = useMemo(() => new Set(notes.filter((n) => isSecret(n) && n.folder === project).map((n) => n.title)).size, [notes, project]);
  const hasYml = info?.ymlText != null;
  const on = hasYml && info?.yml?.ai !== false;
  const command = C.mcpCommand(C.passPlaceholder); // 진짜 비밀번호는 넣지 않는다: 화면과 클립보드에 남지 않게
  const copy = (text: string, msg: string) =>
    void navigator.clipboard.writeText(text).then(
      () => ui.toast(msg),
      () => ui.toast(ko.keys.copyFailed),
    );
  return (
    <section className="connect-card" aria-label={C.ai}>
      <h2>{C.ai}</h2>
      <label className="switch-row connect-switch">
        <span className="row-text">
          <span className="connect-switch-label">{C.aiSwitch}</span>
          <span className="small muted">{hasYml ? C.aiSwitchHint : C.aiNeedsYml}</span>
        </span>
        <span className="small">{on ? C.aiOn : C.aiOff}</span>
        <input type="checkbox" role="switch" className="switch" checked={on} disabled={!hasYml} onChange={(e) => onToggle(e.target.checked)} />
      </label>
      <div className="connect-sub">
        <h3>{C.claude}</h3>
        <p className="small muted">{C.claudeHint}</p>
        <div className="connect-code">
          <code>{command}</code>
          <button type="button" className="key-copy" aria-label={C.copyCommand} title={C.copyCommand} onClick={() => copy(command, C.copiedCommand)}>
            <CopyIcon />
          </button>
        </div>
        <h3>{C.plugin}</h3>
        <div className="connect-code">
          <code>{C.pluginSteps.join('\n')}</code>
        </div>
        <p className="small muted">{C.pluginHint}</p>
      </div>
      <div className="connect-gets">
        <div className="gets yes">
          <span className="gets-label">{C.aiGets}</span>
          <span>{C.aiGetsValue(names)}</span>
        </div>
        <div className="gets no">
          <span className="gets-label">{C.aiNotGets}</span>
          <span>{C.aiNotGetsValue}</span>
        </div>
      </div>
    </section>
  );
}

function AiLog({ project, info }: { project: string; info: FolderInfo }) {
  const notes = useApp((s) => s.notes);
  const have = useMemo(() => new Set(notes.filter((n) => isSecret(n) && n.folder === project).map((n) => n.title)), [notes, project]);
  return (
    <section className="connect-card" aria-label={C.log}>
      <h2>{C.log}</h2>
      {info.aiLog.length === 0 && <p className="small muted">{C.logEmpty}</p>}
      {info.aiLog.map((e, i) => (
        <div key={`${e.at}-${i}`} className="log-row">
          <div className="log-head">
            <span className="mono">{e.command ?? C.logTool[e.tool]}</span>
            <time className="small muted" dateTime={e.at}>{relTime(e.at)}</time>
          </div>
          <div className="log-sub">
            {e.keys && e.keys.length > 0 && <span className="mono small muted">{e.keys.join(', ')}</span>}
            {!!e.redacted && <span className="key-chip">{C.logRedacted(e.redacted)}</span>}
            {e.tool === 'request_key' && e.keys?.some((k) => !have.has(k)) && <span className="key-chip warn">{C.logNotYet}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}
