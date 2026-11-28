import { useEffect, useRef, useState, type FormEvent } from 'react';
import { backupFileName, exportBackup, exportObsidianZip, obsidianZipName, parseMarkdownFiles, WrongPasswordError } from '@vault/core';
import { useApp } from '../app/store';
import { GisDriveAuth } from '../app/driveAuth';
import { GOOGLE_CLIENT_ID, setDeviceName } from '../app/session';
import { proAvailable, proSessionEmail, proSignIn, proSignOut, setProEnabled } from '../pro/supabase';
import { ko, lang, setLang, type Lang } from '../i18n/ko';
import { downloadBytes, pickDirectoryFiles, relTime, shareOrDownload } from '../app/util';
import { usePasswordScore } from '../app/strength';
import { StatusBadge } from '../components/StatusBadge';
import { ui } from '../app/ui';
import { createPasskey, passkeySupported } from '../app/passkey';
import { autoBackupSupported, backupFolder, disableAutoBackup, enableAutoBackup, folderPermission, runAutoBackup } from '../app/autoBackup';
import { BackIcon } from '../components/Icons';
import { connectFolder, disconnectFolder, folderSyncSupported, syncFolder } from '../app/folderSync';
import { RestoreCard } from './UnlockScreen';
import { loadMetrics, summarize } from '../app/metrics';

const S = ko.settings;

export function SettingsScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const [section, setSection] = useState<keyof typeof S.nav>('sync');
  const bodyRef = useRef<HTMLDivElement>(null);
  // 스크롤 위치에 따라 왼쪽 메뉴의 현재 항목을 바꾼다
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setSection(top.target.id as keyof typeof S.nav);
      },
      { root, rootMargin: '-8% 0px -70% 0px' },
    );
    for (const el of Array.from(root.querySelectorAll('section[id]'))) io.observe(el);
    return () => io.disconnect();
  }, []);
  const go = (k: keyof typeof S.nav) => {
    setSection(k);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(k)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  return (
    <div className="settings">
      <header className="topbar" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="back-btn" aria-label={S.backToNotes} onClick={() => setScreen('main')}><BackIcon />{S.backShort}</button>
        <h1 className="page-title">{S.title}</h1>
      </header>
      <div className="settings-body" ref={bodyRef}>
        <div className="settings-inner">
        <nav className="settings-nav" aria-label={S.title}>
          {(Object.keys(S.nav) as (keyof typeof S.nav)[]).map((k) => (
            <button key={k} type="button" aria-current={section === k ? 'true' : undefined} onClick={() => go(k)}>{S.nav[k]}</button>
          ))}
        </nav>
        <div className="settings-main">
          <SyncSection />
          <BackupSection />
          <SecuritySection />
          <DataSection />
          <LookSection />
          <UsageSection />
        </div>
        </div>
      </div>
    </div>
  );
}

/** 폴더를 저장소로: Drive 계정 없이, 사용자가 이미 쓰는 동기화 도구에 얹는다. */
function FolderCard() {
  const app = useApp((s) => s.app);
  const on = app.backendKind === 'folder';
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (on) void syncFolder().then((d) => setName(d?.name ?? null));
  }, [on]);
  const connect = async () => {
    if (await connectFolder()) window.location.reload(); // 저장소가 바뀌므로 세션을 새로 만든다 (Drive 연결과 같은 방식)
  };
  const disconnect = async () => {
    if (!(await ui.confirm({ title: S.sync.folderDisconnectTitle, body: S.sync.folderDisconnectConfirm, confirmLabel: S.sync.driveDisconnect, danger: true }))) return;
    await disconnectFolder();
    window.location.reload();
  };
  return (
    <div className="sync-card">
      <div className="head">
        <span>{S.sync.folder}</span>
        {on ? <span className="badge ok" style={{ fontSize: 11 }}>{S.sync.driveInUse}</span> : <span className="badge muted" style={{ fontSize: 11 }}>{S.sync.driveOff}</span>}
      </div>
      <div className="small muted">{on && name ? S.sync.folderOn(name) : S.sync.folderDesc}</div>
      {!folderSyncSupported() && <div className="small" style={{ color: 'var(--warn)' }}>{S.sync.folderUnsupported}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {on ? (
          <>
            <button type="button" className="btn btn-sm" onClick={() => void app.session.sync()}>{ko.sync.now}</button>
            <button type="button" className="btn-link muted" onClick={() => void disconnect()}>{S.sync.driveDisconnect}</button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" disabled={!folderSyncSupported()} onClick={() => void connect()}>{S.sync.folderConnect}</button>
        )}
      </div>
    </div>
  );
}

function SyncSection() {
  const app = useApp((s) => s.app);
  const status = useApp((s) => s.status);
  const notes = useApp((s) => s.notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(app.deviceName);
  const connected = app.backendKind === 'drive';
  const pro = app.backendKind === 'supabase';
  const [proEmail, setProEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!proAvailable()) return;
    void proSessionEmail().then((email) => {
      setProEmail(email);
      // 로그인 리다이렉트에서 돌아와 세션이 생겼으면 Pro 백엔드로 전환
      if (email && !pro && sessionStorage.getItem('vault.pro.pending') === '1') {
        sessionStorage.removeItem('vault.pro.pending');
        setProEnabled(true);
        window.location.reload();
      }
    });
  }, [pro]);
  const upgrade = async () => {
    if (!proAvailable()) {
      await ui.alert({ title: S.sync.pro, body: S.sync.comingSoon });
      return;
    }
    if (proEmail) {
      setProEnabled(true);
      window.location.reload();
      return;
    }
    sessionStorage.setItem('vault.pro.pending', '1');
    await proSignIn();
  };
  const proOff = async () => {
    if (!(await ui.confirm({ title: S.sync.proDisconnectTitle, body: S.sync.proDisconnectConfirm, confirmLabel: S.sync.proDisconnect, danger: true }))) return;
    await proSignOut();
    window.location.reload();
  };

  const connect = async () => {
    if (!app.driveAuth) return;
    setBusy(true);
    setErr(null);
    try {
      await app.driveAuth.connect();
      window.location.reload(); // 백엔드 교체는 부팅에서 결정한다
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!(await ui.confirm({ title: S.sync.driveDisconnectTitle, body: S.sync.driveDisconnectConfirm, confirmLabel: S.sync.driveDisconnect, danger: true }))) return;
    app.driveAuth?.disconnect();
    window.location.reload();
  };

  return (
    <section id="sync" className="card">
      <h2>{S.nav.sync}</h2>
      <div className="sync-cards">
        <div className="sync-card">
          <div className="head">
            <span>{S.sync.drive}</span>
            {connected ? <span className="badge ok" style={{ fontSize: 11 }}>{S.sync.driveInUse}</span> : <span className="badge muted" style={{ fontSize: 11 }}>{S.sync.driveOff}</span>}
          </div>
          {connected && GisDriveAuth.email() && <div style={{ color: 'var(--ink-2)' }}>{GisDriveAuth.email()}</div>}
          {connected && (
            <div className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <StatusBadge status={status} local={false} /> {ko.main.count(notes.length)}
            </div>
          )}
          {!GOOGLE_CLIENT_ID && <div className="small" style={{ color: 'var(--warn)' }}>{S.sync.driveNoClient}</div>}
          {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {connected ? (
              <>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void app.session.sync()}>{ko.sync.now}</button>
                <button type="button" className="btn-link muted" onClick={() => void disconnect()}>{S.sync.driveDisconnect}</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm" disabled={!GOOGLE_CLIENT_ID || busy} onClick={() => void connect()}>{S.sync.driveConnect}</button>
            )}
          </div>
        </div>
        <FolderCard />
        <div className="sync-card pro">
          <div className="head">
            <span>{S.sync.pro}</span>
            <span className="small muted" style={{ fontWeight: 400 }}>{S.sync.proPrice}</span>
          </div>
          <div style={{ color: 'var(--ink-2)' }}>{S.sync.proDesc}</div>
          {pro ? (
            <div className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={status} local={false} /> {proEmail ?? ''}
              <button type="button" className="btn-link muted" onClick={() => void proOff()}>{S.sync.proDisconnect}</button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => void upgrade()}>{S.sync.upgrade}</button>
          )}
        </div>
      </div>
      <div className="sees">
        <strong style={{ fontWeight: 500 }}>{S.sync.sees}</strong>
        <dl className="sees-list">
          <dt className="yes">{S.sync.seesYes}</dt>
          <dd>{S.sync.seesYesItems}</dd>
          <dt className="no">{S.sync.seesNo}</dt>
          <dd>{S.sync.seesNoItems}</dd>
        </dl>
      </div>
      <div className="row">
        <span>{S.sync.deviceName}</span>
        <div className="input-wrap sm" style={{ width: 240 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setDeviceName(name.trim() || app.deviceName)} aria-label={S.sync.deviceName} />
          {name && <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setName('')}>×</button>}
        </div>
      </div>
    </section>
  );
}

function BackupSection() {
  const app = useApp((s) => s.app);
  const notes = useApp((s) => s.notes);
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const setLastBackup = useApp((s) => s.setLastBackup);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  // 자동 백업 폴더: null = 꺼짐. needPerm = 브라우저를 다시 켠 뒤 폴더 권한을 한 번 더 허용해야 하는 상태
  const [autoDir, setAutoDir] = useState<string | null>(null);
  const [needPerm, setNeedPerm] = useState(false);
  const refreshAuto = async () => {
    const h = await backupFolder();
    setAutoDir(h?.name ?? null);
    setNeedPerm(h ? (await folderPermission(h)) !== 'granted' : false);
  };
  useEffect(() => {
    void refreshAuto();
  }, []);
  const autoOn = async () => {
    const p = pass || (await ui.prompt({ title: S.backup.autoPassTitle, body: S.backup.autoPassBody, label: S.backup.passphrase, password: true, confirmLabel: S.backup.autoPick }));
    if (!p) return;
    try {
      await enableAutoBackup(app, p);
      setPass('');
      await refreshAuto();
      await backupNow(true);
      ui.toast(S.backup.autoSet);
    } catch {
      /* 폴더 고르기를 취소함 */
    }
  };
  const backupNow = async (quiet = false) => {
    const h = await backupFolder();
    if (h && (await folderPermission(h, true)) !== 'granted') return void refreshAuto();
    const r = await runAutoBackup(app, { force: true });
    if (r === 'done') {
      setLastBackup(new Date().toISOString());
      if (!quiet) ui.toast(S.backup.autoDone);
    }
    await refreshAuto();
  };

  const make = async () => {
    if (!pass || busy) return;
    setBusy(true);
    try {
      const bytes = await exportBackup(notes, pass, app.deviceName);
      await shareOrDownload(backupFileName(), bytes);
      setLastBackup(new Date().toISOString());
      setPass('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="backup" className="card">
      <h2>{S.nav.backup}</h2>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="bp">{S.backup.passphrase}</label>
        <div className="input-wrap">
          <input id="bp" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
          {pass && <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setPass('')}>×</button>}
        </div>
      </div>
      <div className="row">
        <span className="small muted">{lastBackupAt && <span style={{ color: 'var(--ok)' }}>✓ </span>}{S.backup.last(lastBackupAt ? relTime(lastBackupAt) : null)}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" disabled={!pass || busy} onClick={() => void make()}>{busy ? S.backup.making : S.backup.download}</button>
          <button type="button" className="btn btn-sm" onClick={() => void ui.alert({ title: S.backup.mail, body: S.backup.mailPro })}>{S.backup.mail}</button>
        </div>
      </div>
      {autoBackupSupported() && (
        <div className="row">
          <span className="row-text">
            {S.backup.auto}
            {autoDir && <span className="small muted">{S.backup.autoOn(autoDir)}</span>}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!autoDir ? (
              <button type="button" className="btn btn-sm" onClick={() => void autoOn()}>{S.backup.autoPick}</button>
            ) : (
              <>
                <button type="button" className="btn btn-sm" onClick={() => void backupNow()}>{needPerm ? S.backup.autoRegrant : S.backup.autoNow}</button>
                <button type="button" className="btn-link muted" onClick={() => void disableAutoBackup().then(refreshAuto)}>{S.backup.autoOff}</button>
              </>
            )}
          </div>
        </div>
      )}
      <div className="row">
        <span>{S.backup.restore}</span>
        <button type="button" className="btn btn-sm" onClick={() => setRestoreOpen(true)}>{S.backup.restore}</button>
      </div>
      {restoreOpen && (
        <div className="overlay center" onClick={() => setRestoreOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <RestoreCard firstRun={false} onBack={() => setRestoreOpen(false)} />
          </div>
        </div>
      )}
    </section>
  );
}

function SecuritySection() {
  const app = useApp((s) => s.app);
  const autoLockMin = useApp((s) => s.autoLockMin);
  const setPref = useApp((s) => s.setPref);
  const [pwOpen, setPwOpen] = useState(false);
  const [rkOpen, setRkOpen] = useState(false);
  const [pkSupported, setPkSupported] = useState<boolean | null>(null);
  const [pkOn, setPkOn] = useState(false);
  const [pkBusy, setPkBusy] = useState(false);
  useEffect(() => {
    void passkeySupported().then(setPkSupported);
    void app.session.deviceUnlockInfo().then((i) => setPkOn(!!i));
  }, [app]);
  const togglePasskey = async (on: boolean) => {
    setPkBusy(true);
    try {
      if (on) {
        const { credentialId, prfSalt, secret } = await createPasskey(app.deviceName);
        await app.session.enableDeviceUnlock(secret, { credentialId, prfSalt });
        secret.fill(0);
        setPkOn(true);
        ui.toast(S.security.passkeyOn);
      } else {
        await app.session.disableDeviceUnlock();
        setPkOn(false);
        ui.toast(S.security.passkeyOff);
      }
    } catch (e) {
      // 사용자가 창을 닫은 경우(NotAllowedError)는 조용히 둔다
      if (!(e instanceof DOMException && e.name === 'NotAllowedError')) ui.toast(S.security.passkeyFailed);
    } finally {
      setPkBusy(false);
    }
  };
  return (
    <section id="security" className="card">
      <h2>{S.nav.security}</h2>
      <p className="small muted unreviewed">{S.security.unreviewed}</p>
      <div className="row">
        <span>{S.security.autoLock}</span>
        <div className="segment" role="group" aria-label={S.security.autoLock}>
          {S.security.autoLockOptions.map((m) => (
            <button key={m} type="button" aria-pressed={autoLockMin === m} onClick={() => setPref('autoLockMin', m)}>{S.security.minutes(m)}</button>
          ))}
        </div>
      </div>
      <label className="row" style={{ cursor: pkSupported ? 'pointer' : 'default' }}>
        <span className="row-text">
          {S.security.passkey}
          {pkSupported === false && <span className="small muted">{S.security.passkeyUnsupported}</span>}
        </span>
        <input type="checkbox" role="switch" className="switch" checked={pkOn} disabled={!pkSupported || pkBusy} onChange={(e) => void togglePasskey(e.target.checked)} />
      </label>
      <div className="row">
        <span>{S.security.changePassword}</span>
        <button type="button" className="btn btn-sm" onClick={() => setPwOpen(true)}>{S.security.change}</button>
      </div>
      <div className="row">
        <span>{S.security.recovery}</span>
        <button type="button" className="btn btn-sm" onClick={() => setRkOpen(true)}>{S.security.issue}</button>
      </div>
      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} />}
      {rkOpen && <RotateRecoveryDialog onClose={() => setRkOpen(false)} />}
    </section>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const app = useApp((s) => s.app);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const nextScore = usePasswordScore(next);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await app.session.changePassword(cur, next);
      setMsg(S.security.changed);
    } catch (ex) {
      setErr(ex instanceof WrongPasswordError ? ko.unlock.wrong : String(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay center" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{S.security.changePassword}</h2>
        <div className="field"><label htmlFor="cur">{S.security.current}</label><div className="input-wrap"><input id="cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></div></div>
        <div className="field"><label htmlFor="nxt">{S.security.next}</label><div className="input-wrap"><input id="nxt" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div><span className="hint">{ko.setup.strength[nextScore]}{next && nextScore < 3 ? ` ${ko.setup.tooWeak}` : ''}</span></div>
        {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
        {msg && <p className="small" style={{ color: 'var(--ok)' }}>{msg}</p>}
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={onClose}>{ko.common.close}</button>
          {!msg && <button type="submit" className="btn btn-primary btn-sm" disabled={!cur || nextScore < 3 || busy}>{S.security.change}</button>}
        </div>
      </form>
    </div>
  );
}

function RotateRecoveryDialog({ onClose }: { onClose: () => void }) {
  const app = useApp((s) => s.app);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setPhrase(await app.session.rotateRecoveryPhrase(pw));
    } catch (ex) {
      setErr(ex instanceof WrongPasswordError ? ko.unlock.wrong : String(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay center" onClick={phrase ? undefined : onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{S.security.recovery}</h2>
        {phrase ? (
          <>
            <p className="small muted">{ko.setup.phraseSub}</p>
            <div className="phrase-grid">{phrase.map((w, i) => <span key={i}><i>{i + 1}</i>{w}</span>)}</div>
            <div className="actions"><button type="button" className="btn btn-primary btn-sm" onClick={onClose}>{ko.setup.phraseAck}</button></div>
          </>
        ) : (
          <>
            <p className="small muted">{S.security.recoveryHint}</p>
            <div className="field"><label htmlFor="rpw">{ko.unlock.password}</label><div className="input-wrap"><input id="rpw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></div></div>
            {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
            <div className="actions">
              <button type="button" className="btn btn-sm" onClick={onClose}>{ko.common.cancel}</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!pw || busy}>{S.security.issue}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function DataSection() {
  const app = useApp((s) => s.app);
  const notes = useApp((s) => s.notes);
  const [msg, setMsg] = useState<string | null>(null);
  const exportZip = async () => {
    if (!(await ui.confirm({ title: S.data.obsidianTitle, body: S.data.obsidianWarn, confirmLabel: S.data.export }))) return;
    downloadBytes(obsidianZipName(), exportObsidianZip(notes), 'application/zip');
  };
  const importMd = async () => {
    const files = await pickDirectoryFiles();
    if (!files.length) return;
    let added = 0;
    for (const input of parseMarkdownFiles(files)) {
      await app.session.save(input);
      added++;
    }
    setMsg(S.data.imported(added, 0, 0));
  };
  const deleteAll = async () => {
    const ok = await ui.confirm({ title: S.data.deleteTitle, body: S.data.deleteConfirm, requireWord: S.data.deleteWord, confirmLabel: S.data.deleteWord, danger: true });
    if (!ok) return;
    await app.session.purgeEverything();
    await disableAutoBackup(); // 이 기기에 남긴 폴더 권한과 잠근 백업 비밀번호도 지운다
    await disconnectFolder(); // 동기화 폴더 권한도 지운다 (폴더 안의 암호문은 purgeEverything이 지웠다)
    app.driveAuth?.disconnect();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.reload();
  };
  return (
    <section id="data" className="card">
      <h2>{S.nav.data}</h2>
      <div className="row"><span>{S.data.obsidian} <span className="muted">({S.data.obsidianHint})</span></span><button type="button" className="btn btn-sm" onClick={() => void exportZip()}>{S.data.export}</button></div>
      <div className="row"><span>{S.data.importMd}</span><button type="button" className="btn btn-sm" onClick={() => void importMd()}>{S.data.import}</button></div>
      {msg && <p className="small" style={{ color: 'var(--ok)' }}>{msg}</p>}
      <div className="row"><span>{S.data.deleteAll} <span className="muted">({S.data.deleteAllHint})</span></span><button type="button" className="btn btn-sm btn-danger" onClick={() => void deleteAll()}>{S.data.deleteBtn}</button></div>
    </section>
  );
}

/** 이 기기에서만 센 사용 수치 (docs/KPI.md). 보내지 않고, 사용자가 원할 때만 복사해 건넨다. */
function UsageSection() {
  const U = S.usage;
  const s = summarize(loadMetrics(), Date.now());
  const rows: [string, string][] = [
    [U.firstNote, s.firstNoteSec === null ? U.none : U.seconds(s.firstNoteSec)],
    [U.capture, s.captureSec === null ? U.none : U.seconds(s.captureSec)],
    [U.active7, U.days(s.active7)],
    [U.active28, U.days(s.active28)],
    [U.passkey, s.passkeyShare === null ? U.none : U.percent(s.passkeyShare)],
    [U.quick, s.quickShare === null ? U.none : U.percent(s.quickShare)],
  ];
  const copy = () => void navigator.clipboard.writeText(JSON.stringify(s)).then(() => ui.toast(ko.common.copied));
  return (
    <section id="usage" className="card">
      <h2>{S.nav.usage}</h2>
      {rows.map(([label, value]) => (
        <div key={label} className="row">
          <span>{label}</span>
          <span className="usage-value">{value}</span>
        </div>
      ))}
      <div className="row">
        <span className="small muted">{U.local}</span>
        <button type="button" className="btn btn-sm" onClick={copy}>{U.copy}</button>
      </div>
    </section>
  );
}

/** 문구는 앱을 읽을 때 한 번 정해지므로, 언어를 바꾸면 저장하고 새로 고친다 (잠금 화면으로 돌아간다). */
function changeLang(next: Lang) {
  if (next === lang) return;
  setLang(next);
  window.location.reload();
}

const SOURCE_URL = 'https://github.com/keys-kept/keys-kept';

function LookSection() {
  const theme = useApp((s) => s.theme);
  const fontSize = useApp((s) => s.fontSize);
  const editorWidth = useApp((s) => s.editorWidth);
  const setPref = useApp((s) => s.setPref);
  return (
    <section id="look" className="card">
      <h2>{S.nav.look}</h2>
      <div className="row">
        <span>{S.look.theme}</span>
        <div className="segment" role="group" aria-label={S.look.theme}>
          {(['light', 'dark', 'system'] as const).map((t) => <button key={t} type="button" aria-pressed={theme === t} onClick={() => setPref('theme', t)}>{S.look.themes[t]}</button>)}
        </div>
      </div>
      <div className="row">
        <span>{S.look.fontSize}</span>
        <div className="segment" role="group" aria-label={S.look.fontSize}>
          {(['s', 'm', 'l'] as const).map((t) => <button key={t} type="button" aria-pressed={fontSize === t} onClick={() => setPref('fontSize', t)}>{S.look.sizes[t]}</button>)}
        </div>
      </div>
      <div className="row desktop-only">
        <span>{S.look.editorWidth}</span>
        <div className="segment" role="group" aria-label={S.look.editorWidth}>
          {(['narrow', 'normal', 'wide'] as const).map((t) => <button key={t} type="button" aria-pressed={editorWidth === t} onClick={() => setPref('editorWidth', t)}>{S.look.widths[t]}</button>)}
        </div>
      </div>
      <div className="row">
        <span>{S.look.language}</span>
        <div className="segment" role="group" aria-label={S.look.language}>
          {(['ko', 'en'] as const).map((t) => <button key={t} type="button" lang={t} aria-pressed={lang === t} onClick={() => changeLang(t)}>{S.look.languages[t]}</button>)}
        </div>
      </div>
      {/* AGPL-3.0 13조: 네트워크로 쓰는 사람도 소스를 받을 수 있어야 한다 */}
      <p className="small muted">{S.source} <a href={SOURCE_URL} target="_blank" rel="noreferrer">{SOURCE_URL.replace('https://', '')}</a> · AGPL-3.0</p>
    </section>
  );
}
