import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { lang } from './i18n/ko';
// 글꼴은 앱에 넣어 둔다. 외부 글꼴 서버를 부르면 앱을 켤 때마다 접속 사실이 제3자에게 전달된다.
// 한글은 글자 묶음(unicode-range)별 파일로 나뉘어 있어, 화면에 나온 글자의 묶음만 내려받는다.
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import '@fontsource/hahmlet/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './styles/tokens.css';
import './styles/app.css';

// 화면 낭독기와 브라우저 번역·맞춤법 검사가 고른 언어를 알도록 (index.html의 기본값은 ko)
document.documentElement.lang = lang;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
