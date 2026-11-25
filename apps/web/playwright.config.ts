import { defineConfig } from '@playwright/test';

/**
 * 화면 흐름 테스트. 설치된 Chrome을 그대로 쓴다(브라우저를 따로 내려받지 않는다).
 * 테스트마다 새 브라우저 컨텍스트라 IndexedDB·localStorage가 비어 있다 = 매번 "처음 설정"부터.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // Argon2id가 테스트마다 256MB를 쓴다
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', channel: 'chrome', viewport: { width: 1280, height: 800 }, locale: 'ko-KR' },
  webServer: { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
});
