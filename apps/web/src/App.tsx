import { ko } from './i18n/ko';

/** 3단계에서 잠금 화면·메인으로 교체한다. */
export function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)' }}>{ko.app.name}</h1>
      <p>{ko.app.tagline}</p>
    </main>
  );
}
