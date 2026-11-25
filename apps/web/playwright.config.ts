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
  // CI에서는 실패 메시지를 GitHub 주석으로도 남긴다 (로그를 내려받지 않고 원인을 볼 수 있게)
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { baseURL: 'http://localhost:5173', channel: 'chrome', viewport: { width: 1280, height: 800 }, locale: 'ko-KR' },
  // Drive 연결 버튼은 클라이언트 ID가 있어야 켜진다. CI에는 .env가 없으므로 테스트용 값을 준다(가짜 Drive만 부른다).
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? 'e2e-client-id' },
  },
});
