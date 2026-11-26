import { useEffect } from 'react';
import { bootApp, lockNow, useApp } from './app/store';
import { DialogHost } from './components/DialogHost';
import { Logo } from './components/Seal';
import { startAutoLock } from './app/autoLock';
import { clearLinks, loadLinks, notesChanged } from './app/codeLink';
import { UnlockScreen } from './screens/UnlockScreen';
import { MainScreen } from './screens/MainScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export function App() {
  const locked = useApp((s) => s.locked);
  const theme = useApp((s) => s.theme);
  const fontSize = useApp((s) => s.fontSize);
  const editorWidth = useApp((s) => s.editorWidth);
  const autoLockMin = useApp((s) => s.autoLockMin);
  const app = useApp((s) => s.app);

  useEffect(() => {
    void bootApp();
  }, []);

  // 테마·글꼴 크기 → 문서 루트 (DESIGN.md 토큰)
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const base = mobile ? 16 : 15;
    document.documentElement.style.setProperty('--body-size', `${base + (fontSize === 's' ? -1 : fontSize === 'l' ? 2 : 0)}px`);
  }, [fontSize]);

  useEffect(() => {
    const w = editorWidth === 'narrow' ? '620px' : editorWidth === 'wide' ? 'none' : '760px';
    document.documentElement.style.setProperty('--editor-width', w);
  }, [editorWidth]);

  // 자동 잠금 (SPEC §1.2)
  useEffect(() => {
    if (locked || autoLockMin <= 0) return;
    return startAutoLock(autoLockMin, () => void lockNow());
  }, [locked, autoLockMin, app]);

  // 코드 폴더 연결 (docs/STRATEGY.md 계획 15): 잠금을 풀면 연결을 읽고, 키가 바뀌면 그 폴더의 키 파일을 다시 쓴다
  useEffect(() => {
    if (locked) {
      clearLinks();
      return;
    }
    let alive = true;
    void loadLinks(app).then(() => alive && notesChanged(app, () => useApp.getState().notes));
    const off = useApp.subscribe((s, prev) => {
      if (s.notes !== prev.notes && !s.locked) notesChanged(app, () => useApp.getState().notes);
    });
    return () => {
      alive = false;
      off();
    };
  }, [locked, app]);

  // Realtime 백엔드(Pro)가 있으면 변경 알림 → 동기화
  useEffect(() => {
    if (locked) return;
    return app.session.subscribeBackend(() => app.scheduler.requestNow());
  }, [locked, app]);

  return (
    <>
      <Screen />
      <DialogHost />
    </>
  );
}

function Screen() {
  const screen = useApp((s) => s.screen);
  const locked = useApp((s) => s.locked);
  if (screen === 'loading') {
    return (
      <div className="unlock-right" style={{ minHeight: '100%' }}>
        <div className="unlock-card" aria-busy="true">
          <Logo />
          <div className="skeleton" />
          <div className="skeleton" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }
  if (screen === 'setup') return <UnlockScreen firstRun />;
  if (screen === 'unlock' || locked) return <UnlockScreen firstRun={false} />;
  if (screen === 'settings') return <SettingsScreen />;
  return <MainScreen />;
}
