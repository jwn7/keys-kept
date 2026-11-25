import { defineConfig, loadEnv, type Plugin } from 'vite';
import type {} from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 콘텐츠 보안 정책(CSP). 배포 빌드의 index.html에 넣는다 (개발 서버는 HMR이 인라인 스크립트를 써서 제외).
 * 목적: 의존성이나 메모 내용을 통해 악성 스크립트가 끼어들어도 (1) 바깥 스크립트를 불러오지 못하고
 * (2) 복호화된 메모를 허용 목록 밖의 서버로 보내지 못하게 한다. docs/SECURITY.md 참고.
 * 허용 목록은 이 앱이 실제로 말을 거는 곳뿐이다: 자기 자신, Google 로그인·Drive, (설정했다면) Supabase.
 */
function csp(mode: string): Plugin {
  return {
    name: 'vault-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const supabase = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL;
      const supabaseOrigins = supabase ? [new URL(supabase).origin, new URL(supabase).origin.replace(/^http/, 'ws')] : [];
      const policy = [
        "default-src 'none'",
        "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com", // wasm: libsodium
        "style-src 'self' 'unsafe-inline'", // 편집기(CodeMirror)와 React의 style 속성
        "img-src 'self' data: blob:",
        "font-src 'self' data:", // 작은 글꼴 묶음은 빌드가 data: 로 넣는다
        `connect-src ${["'self'", 'https://www.googleapis.com', 'https://accounts.google.com', ...supabaseOrigins].join(' ')}`,
        'frame-src https://accounts.google.com',
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join('; ');
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    csp(mode),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Vault — 나만 여는 키 장부',
        short_name: 'Vault',
        description: 'API 키와 환경변수를 기기에서 잠그는 키 장부',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        // 설치한 앱 아이콘을 길게 누르면(PC는 우클릭) 나오는 바로가기. 주소에 메모 내용은 넣지 않는다.
        shortcuts: [
          { name: '새 메모', url: '/?action=new' },
          { name: '오늘의 메모', url: '/?action=today' },
        ],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // 앱 셸은 프리캐시. 글꼴은 한글 묶음 파일이 수백 개라 미리 받지 않고, 쓰인 묶음만 받아 캐시에 둔다.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          { urlPattern: ({ url, sameOrigin }) => sameOrigin && /\.woff2?$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  build: { target: 'es2022', sourcemap: false },
}));
