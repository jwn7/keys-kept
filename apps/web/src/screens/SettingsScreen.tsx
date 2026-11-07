import { useEffect, useState, type FormEvent } from 'react';
import { backupFileName, exportBackup, exportObsidianZip, obsidianZipName, parseMarkdownFiles, WrongPasswordError } from '@vault/core';
import { useApp } from '../app/store';
import { GisDriveAuth } from '../app/driveAuth';
import { GOOGLE_CLIENT_ID, setDeviceName } from '../app/session';
import { proAvailable, proSessionEmail, proSignIn, proSignOut, setProEnabled } from '../pro/supabase';
import { ko } from '../i18n/ko';
import { downloadBytes, passwordScore, pickDirectoryFiles, relTime, shareOrDownload } from '../app/util';
import { StatusBadge } from '../components/StatusBadge';
import { RestoreCard } from './UnlockScreen';

const S = ko.settings;

export function SettingsScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const [section, setSection] = useState<keyof typeof S.nav>('sync');
  return (
    <div className="settings">
      <header className="topbar" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn-link" onClick={() => setScreen('main')}>← {S.backToNotes}</button>
        <strong>{S.title}</strong>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label={S.title}>
          {(Object.keys(S.nav) as (keyof typeof S.nav)[]).map((k) => (
            <a key={k} href={`#${k}`} aria-current={section === k ? 'true' : undefined} onClick={() => setSection(k)}>{S.nav[k]}</a>
          ))}
        </nav>
        <div className="settings-main">
          <SyncSection />
          <BackupSection />
          <SecuritySection />
          <DataSection />
          <LookSection />
        </div>
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
      window.alert(S.sync.comingSoon);
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
    if (!window.confirm(S.sync.proDisconnectConfirm)) return;
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
  const disconnect = () => {
    if (!window.confirm(S.sync.driveDisconnectConfirm)) return;
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
          <div style={{ color: 'var(--ink-2)' }}>{S.sync.driveDesc(connected ? GisDriveAuth.email() : null)}</div>
          {connected && (
            <div className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <StatusBadge status={status} local={false} /> · {ko.main.count(notes.length)}
            </div>
          )}
          {!GOOGLE_CLIENT_ID && <div className="small" style={{ color: 'var(--warn)' }}>{S.sync.driveNoClient}</div>}
          {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {connected ? (
              <>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void app.session.sync()}>{ko.sync.now}</button>
                <button type="button" className="btn-link muted" onClick={disconnect}>{S.sync.driveDisconnect}</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm" disabled={!GOOGLE_CLIENT_ID || busy} onClick={() => void connect()}>{S.sync.driveConnect}</button>
            )}
          </div>
        </div>
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
        <div className="grid">
          <div><span className="yes">✓</span> {S.sync.seesYes.slice(1)}</div>
          <div><span className="no">✕</span> {S.sync.seesNo.slice(1)}</div>
        </div>
      </div>
      <div className="row">
        <span>{S.sync.deviceName}</span>
        <div className="input-wrap sm" style={{ width: 240 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setDeviceName(name.trim() || app.deviceName)} aria-label={S.sync.deviceName} />
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
      <p className="small" style={{ color: 'var(--ink-2)' }}>{S.backup.desc}</p>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="bp">{S.backup.passphrase}</label>
        <div className="input-wrap">
          <input id="bp" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
          {pass && <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setPass('')}>×</button>}
        </div>
      </div>
      <div className="row">
        <span className="small muted"><span style={{ color: 'var(--ok)' }}>✓</span> {S.backup.last(lastBackupAt ? relTime(lastBackupAt) : null)}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" disabled={!pass || busy} onClick={() => void make()}>{busy ? S.backup.making : S.backup.download}</button>
          <button type="button" className="btn btn-sm" onClick={() => window.alert(S.backup.mailPro)}>{S.backup.mail}</button>
        </div>
      </div>
      <div className="row">
        <span>{S.backup.restore}</span>
        <button type="button" className="btn btn-sm" onClick={() => setRestoreOpen(true)}>{S.backup.restore}</button>
      </div>
      {restoreOpen && (
        <div className="overlay" onClick={() => setRestoreOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460 }}>
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
  return (
    <section id="security" className="card">
      <h2>{S.nav.security}</h2>
      <div className="row"><span className="muted">{S.security.pcNote}</span></div>
      <div className="row">
        <span>{S.security.autoLock}</span>
        <div className="segment" role="group" aria-label={S.security.autoLock}>
          {S.security.autoLockOptions.map((m) => (
            <button key={m} type="button" aria-pressed={autoLockMin === m} onClick={() => setPref('autoLockMin', m)}>{S.security.minutes(m)}</button>
          ))}
        </div>
      </div>
      <div className="row">
        <span>{S.security.changePassword}</span>
        <button type="button" className="btn btn-sm" onClick={() => setPwOpen(true)}>{S.security.change}</button>
      </div>
      <div className="row">
        <span>{S.security.recovery} <span className="muted">({S.security.recoveryHint})</span></span>
        <button type="button" className="btn btn-sm" onClick={() => setRkOpen(true)}>{S.security.issue}</button>
      </div>
      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} />}
      {rkOpen && <RotateRecoveryDialog onClose={() => setRkOpen(false)} />}
      <span className="sr-only">{app.deviceId}</span>
    </section>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const app = useApp((s) => s.app);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
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
    <div className="overlay" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{S.security.changePassword}</h2>
        <div className="field"><label htmlFor="cur">{S.security.current}</label><div className="input-wrap"><input id="cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></div></div>
        <div className="field"><label htmlFor="nxt">{S.security.next}</label><div className="input-wrap"><input id="nxt" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div><span className="hint">{ko.setup.strength[passwordScore(next)]}</span></div>
        {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
        {msg && <p className="small" style={{ color: 'var(--ok)' }}>{msg}</p>}
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={onClose}>{ko.common.close}</button>
          {!msg && <button type="submit" className="btn btn-primary btn-sm" disabled={!cur || passwordScore(next) < 3 || busy}>{S.security.change}</button>}
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
    <div className="overlay" onClick={phrase ? undefined : onClose}>
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
  const exportZip = () => {
    if (!window.confirm(S.data.obsidianWarn)) return;
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
    const word = window.prompt(S.data.deleteConfirm);
    if (word !== S.data.deleteWord) return;
    await app.session.purgeEverything();
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
      <div className="row"><span>{S.data.obsidian} <span className="muted">({S.data.obsidianHint})</span></span><button type="button" className="btn btn-sm" onClick={exportZip}>{S.data.export}</button></div>
      <div className="row"><span>{S.data.importMd}</span><button type="button" className="btn btn-sm" onClick={() => void importMd()}>{S.data.import}</button></div>
      {msg && <p className="small" style={{ color: 'var(--ok)' }}>{msg}</p>}
      <div className="row"><span>{S.data.deleteAll} <span className="muted">({S.data.deleteAllHint})</span></span><button type="button" className="btn btn-sm btn-danger" onClick={() => void deleteAll()}>{S.data.deleteBtn}</button></div>
    </section>
  );
}

function LookSection() {
  const theme = useApp((s) => s.theme);
  const fontSize = useApp((s) => s.fontSize);
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
    </section>
  );
}
