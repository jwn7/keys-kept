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
        background_color: '#F7F4EE',
        theme_color: '#A8372B',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // 앱 셸은 프리캐시. Google API·GIS·폰트는 네트워크 우선 (토큰·동의 화면은 캐시하면 안 된다).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  build: { target: 'es2022', sourcemap: false },
});
