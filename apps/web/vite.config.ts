import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Vault — 개발자도 못 보는 메모장',
        short_name: 'Vault',
        description: '기기에서 잠그는 제로-널리지 메모장',
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
});
