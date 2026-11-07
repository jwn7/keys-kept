import { useEffect } from 'react';
import { bootApp, useApp } from './app/store';
import { startAutoLock } from './app/autoLock';
import { UnlockScreen } from './screens/UnlockScreen';
import { MainScreen } from './screens/MainScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ko } from './i18n/ko';

export function App() {
  const screen = useApp((s) => s.screen);
  const locked = useApp((s) => s.locked);
  const theme = useApp((s) => s.theme);
  const fontSize = useApp((s) => s.fontSize);
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

  // 자동 잠금 (SPEC §1.2)
  useEffect(() => {
    if (locked || autoLockMin <= 0) return;
    return startAutoLock(autoLockMin, () => app.session.lock());
  }, [locked, autoLockMin, app]);

  // Realtime 백엔드(Pro)가 있으면 변경 알림 → 동기화
  useEffect(() => {
    if (locked) return;
    return app.session.subscribeBackend(() => app.scheduler.requestNow());
  }, [locked, app]);

  if (screen === 'loading') {
    return (
      <div className="unlock-right" style={{ minHeight: '100%' }}>
        <div className="unlock-card" aria-busy="true">
          <span className="logo">{ko.app.name}</span>
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
