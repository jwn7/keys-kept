import { useEffect, useState, type FormEvent } from 'react';
import { WrongPasswordError, NotSetUpError, BackupFormatError, BackupPassphraseError, importBackup } from '@vault/core';
import { useApp } from '../app/store';
import { ko } from '../i18n/ko';
import { pickFile, relTime } from '../app/util';
import { usePasswordScore } from '../app/strength';
import { GOOGLE_CLIENT_ID } from '../app/session';
import { evaluatePasskey } from '../app/passkey';
import { markInstalled, markUnlock } from '../app/metrics';
import { Logo } from '../components/Seal';

type Mode = 'password' | 'recovery' | 'restore';

export function UnlockScreen({ firstRun }: { firstRun: boolean }) {
  const app = useApp((s) => s.app);
  const autoLockMin = useApp((s) => s.autoLockMin);
  const setPref = useApp((s) => s.setPref);
  const [mode, setMode] = useState<Mode>('password');
  const [count, setCount] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    // 잠금 중에도 알 수 있는 것: 암호문 개수, 마지막 동기화 시각 (평문 아님)
    void app.session.lockedStats().then((s) => {
      setCount(s.blobs);
      setLastSync(s.lastSyncAt);
    });
  }, [app]);

  return (
    <div className="unlock">
      <section className="unlock-left">
        <Logo fontSize={18} />
        <div className="unlock-pitch">
          <h1>
            {ko.app.taglineLines[0]}
            <br />
            {ko.app.taglineLines[1]}
          </h1>
          <dl className="unlock-facts">
            {ko.app.sees.map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="small muted">{count !== null ? ko.app.localCount(count, lastSync && relTime(lastSync)) : ' '}</p>
      </section>
      <section className="unlock-right">
        {firstRun && mode !== 'restore' ? (
          <SetupCard onRestore={() => setMode('restore')} />
        ) : mode === 'password' ? (
          <PasswordCard autoLockMin={autoLockMin} setAutoLock={(m) => setPref('autoLockMin', m)} onRecovery={() => setMode('recovery')} onRestore={() => setMode('restore')} />
        ) : mode === 'recovery' ? (
          <RecoveryCard onBack={() => setMode('password')} />
        ) : (
          <RestoreCard firstRun={firstRun} onBack={() => setMode('password')} />
        )}
      </section>
    </div>
  );
}

function PasswordField({ id, label, value, onChange, placeholder, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus} />
        {value && (
          <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => onChange('')}>
            ×
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 36 }} onClick={() => setShow((s) => !s)} aria-pressed={show}>
          {show ? ko.common.hide : ko.common.show}
        </button>
      </div>
    </div>
  );
}

function PasswordCard({ autoLockMin, setAutoLock, onRecovery, onRestore }: { autoLockMin: number; setAutoLock: (m: number) => void; onRecovery: () => void; onRestore: () => void }) {
  const app = useApp((s) => s.app);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkey, setPasskey] = useState<{ credentialId: string; prfSalt: string } | null>(null);
  useEffect(() => {
    void app.session.deviceUnlockInfo().then(setPasskey).catch(() => setPasskey(null));
  }, [app]);

  // 패스키: 인증기가 준 비밀값으로 이 기기에 둔 감싼 열쇠를 푼다. 실패하면 비밀번호 경로가 그대로 있다.
  const openWithPasskey = async () => {
    if (!passkey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const secret = await evaluatePasskey(passkey.credentialId, passkey.prfSalt);
      await app.session.unlockWithDeviceSecret(secret);
      markUnlock('passkey');
      secret.fill(0);
    } catch {
      setError(ko.unlock.passkeyFailed);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      await app.session.unlock(pw);
      markUnlock('password');
      setPw('');
    } catch (err) {
      if (err instanceof WrongPasswordError) setError(ko.unlock.wrong);
      else if (err instanceof NotSetUpError) setError(ko.setup.driveEmpty);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="unlock-card" onSubmit={submit}>
      <div>
        <h2>{ko.unlock.title}</h2>
      </div>
      <PasswordField id="pw" label={ko.unlock.password} value={pw} onChange={setPw} placeholder={ko.unlock.passwordPlaceholder} autoFocus />
      {error && <p className="error small" style={{ color: 'var(--danger)' }}>{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={!pw || busy} style={{ height: 48 }}>
        {busy ? ko.unlock.deriving : ko.unlock.open}
      </button>
      {passkey && (
        <button type="button" className="btn" disabled={busy} style={{ height: 48 }} onClick={() => void openWithPasskey()}>
          {ko.unlock.passkey}
        </button>
      )}
      <label className="switch-row">
        <span>{ko.unlock.autoLock(autoLockMin || 15)}</span>
        <input type="checkbox" role="switch" className="switch" checked={autoLockMin > 0} onChange={(e) => setAutoLock(e.target.checked ? 15 : 0)} />
      </label>
      <div className="unlock-links">
        <button type="button" className="btn-link" onClick={onRecovery}>{ko.unlock.forgot}</button>
        <button type="button" className="btn-link muted" onClick={onRestore}>{ko.unlock.restoreBackup}</button>
      </div>
    </form>
  );
}

function RecoveryCard({ onBack }: { onBack: () => void }) {
  const app = useApp((s) => s.app);
  const [phrase, setPhrase] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = phrase.trim().split(/\s+/).filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await app.session.resetPasswordWithRecovery(words, pw);
      markUnlock('recovery');
    } catch (err) {
      setError(err instanceof WrongPasswordError ? ko.unlock.recoveryWrong : String(err));
    } finally {
      setBusy(false);
    }
  };
  const score = usePasswordScore(pw);
  return (
    <form className="unlock-card" onSubmit={submit}>
      <div>
        <h2>{ko.unlock.recoveryTitle}</h2>
        <p className="small muted">{ko.unlock.recoverySub}</p>
      </div>
      <div className="field">
        <label htmlFor="phrase">{ko.setup.phraseTitle}</label>
        <textarea id="phrase" className="plain" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={ko.unlock.recoveryPlaceholder} rows={3} autoFocus />
        <span className="hint">{words.length} / 12</span>
      </div>
      <PasswordField id="newpw" label={ko.unlock.newPassword} value={pw} onChange={setPw} placeholder={ko.unlock.passwordPlaceholder} />
      <Strength score={score} />
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={words.length !== 12 || score < 3 || busy} style={{ height: 48 }}>
        {busy ? ko.unlock.deriving : ko.unlock.setPasswordAndOpen}
      </button>
      <div className="unlock-links">
        <button type="button" className="btn-link muted" onClick={onBack}>{ko.common.back}</button>
      </div>
    </form>
  );
}

function Strength({ score }: { score: number }) {
  const colors = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--ok)', 'var(--ok)'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="strength" aria-hidden="true">
        <div style={{ width: `${(score / 4) * 100}%`, background: colors[score] }} />
      </div>
      <span className="small muted">
        <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{ko.setup.strength[score]}</strong>
        {score < 3 && <> {ko.setup.tooWeak}</>}
      </span>
    </div>
  );
}

/** 복구 문구 12단어 표시. 닫으면 다시 볼 수 없다. */
function PhraseView({ phrase, onAck, step }: { phrase: string[]; onAck: () => void; step?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="unlock-card">
      <div>
        {step && <span className="steps">{step}</span>}
        <h2>{ko.setup.phraseTitle}</h2>
        <p className="small muted">{ko.setup.phraseSub}</p>
      </div>
      <div className="phrase-grid">
        {phrase.map((w, i) => (
          <span key={i}>
            <i>{i + 1}</i>
            {w}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(phrase.join(' '));
            setCopied(true);
          }}
        >
          {copied ? ko.common.copied : ko.setup.phraseCopy}
        </button>
      </div>
      <button type="button" className="btn btn-primary" style={{ height: 48 }} onClick={onAck}>
        {ko.setup.phraseAck}
      </button>
    </div>
  );
}

function SetupCard({ onRestore }: { onRestore: () => void }) {
  const app = useApp((s) => s.app);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const score = usePasswordScore(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (score < 3 || pw !== pw2 || busy) return;
    setBusy(true);
    try {
      const { recoveryPhrase } = await app.session.setup(pw);
      setPhrase(recoveryPhrase);
      setPw('');
      setPw2('');
    } finally {
      setBusy(false);
    }
  };

  if (phrase) return <PhraseView phrase={phrase} step={ko.setup.step(2, 2)} onAck={() => {
    markInstalled(); // 복구 키를 적은 뒤부터 잰다: 첫 메모까지 걸린 시간 (docs/KPI.md)
    useApp.getState().setScreen('main');
  }} />;

  return (
    <form className="unlock-card" onSubmit={submit}>
      <div>
        <span className="steps">{ko.setup.step(1, 2)}</span>
        <h2>{ko.setup.title}</h2>
        <p className="small muted">{ko.setup.subShort}</p>
      </div>
      <PasswordField id="pw" label={ko.setup.password} value={pw} onChange={setPw} placeholder={ko.unlock.passwordPlaceholder} autoFocus />
      <Strength score={score} />
      <PasswordField id="pw2" label={ko.setup.confirm} value={pw2} onChange={setPw2} />
      {mismatch && <p className="small" style={{ color: 'var(--danger)' }}>{ko.setup.mismatch}</p>}
      <button type="submit" className="btn btn-primary" disabled={score < 3 || pw !== pw2 || !pw2 || busy} style={{ height: 48 }}>
        {busy ? ko.setup.creating : ko.setup.create}
      </button>
      <div className="unlock-links">
        {/* 새 기기: 열쇠를 새로 만들지 않고 Drive의 볼트를 연다. 연결 후 다시 부팅하면 잠금 해제 화면이 뜬다 (bootApp). */}
        {GOOGLE_CLIENT_ID && app.driveAuth ? (
          <button type="button" className="btn-link" onClick={() => void app.driveAuth?.connect().then(() => window.location.reload())}>{ko.setup.fromDrive}</button>
        ) : (
          <span />
        )}
        <button type="button" className="btn-link muted" onClick={onRestore}>{ko.unlock.restoreBackup}</button>
      </div>
    </form>
  );
}

export function RestoreCard({ firstRun, onBack, onDone }: { firstRun: boolean; onBack: () => void; onDone?: () => void }) {
  const app = useApp((s) => s.app);
  const locked = useApp((s) => s.locked);
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState('');
  const [master, setMaster] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const needMaster = locked;
  const masterScore = usePasswordScore(firstRun ? master : '');

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const backup = await importBackup(new Uint8Array(await file.arrayBuffer()), pass);
      let newPhrase: string[] | null = null;
      if (app.session.isLocked) {
        if (firstRun) newPhrase = (await app.session.setup(master)).recoveryPhrase;
        else await app.session.unlock(master);
      }
      const r = await app.session.mergeNotes(backup.notes);
      setMsg(ko.restore.result(r.added, r.updated, r.skipped));
      if (newPhrase) setPhrase(newPhrase);
      else onDone?.();
    } catch (err) {
      if (err instanceof BackupPassphraseError) setError(ko.restore.wrongPass);
      else if (err instanceof BackupFormatError) setError(ko.restore.badFormat);
      else if (err instanceof WrongPasswordError) setError(ko.unlock.wrong);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (phrase) return <PhraseView phrase={phrase} onAck={() => useApp.getState().setScreen('main')} />;

  return (
    <form className="unlock-card" onSubmit={run}>
      <div>
        <h2>{ko.restore.title}</h2>
      </div>
      <div className="field">
        <button type="button" className="btn" onClick={async () => setFile((await pickFile('.age'))[0] ?? null)}>
          {file ? file.name : ko.restore.pickFile}
        </button>
      </div>
      <PasswordField id="bpass" label={ko.restore.passphrase} value={pass} onChange={setPass} />
      {needMaster && (
        <>
          <p className="small muted">{firstRun ? ko.restore.masterNew : ko.restore.masterNeeded}</p>
          <PasswordField id="master" label={firstRun ? ko.unlock.newPassword : ko.unlock.password} value={master} onChange={setMaster} />
        </>
      )}
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
      {msg && <p className="small" style={{ color: 'var(--ok)' }}>{msg}</p>}
      <button type="submit" className="btn btn-primary" disabled={!file || !pass || (needMaster && (firstRun ? masterScore < 3 : !master)) || busy} style={{ height: 48 }}>
        {busy ? ko.restore.running : ko.restore.run}
      </button>
      <div className="unlock-links">
        <button type="button" className="btn-link muted" onClick={onBack}>{ko.common.back}</button>
      </div>
    </form>
  );
}
