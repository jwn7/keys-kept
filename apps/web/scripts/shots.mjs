// 디자인 검토용 화면 캡처. 개발 서버(5173)가 떠 있어야 한다.
//   node scripts/shots.mjs <출력 폴더> [light|dark]
// 예시 키를 넣고 주요 화면을 PC(1440×900)와 모바일(390×844)로 찍는다. 테스트가 아니라 눈으로 보기 위한 도구.
// 값은 모두 캡처 전용 가짜 값이다. 키 모양은 조각을 이어 붙인다(비밀 검사기가 막지 않게).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
const scheme = process.argv[3] === 'dark' ? 'dark' : 'light';
mkdirSync(out, { recursive: true });
const URL = 'http://localhost:5173/';
const PASSWORD = 'shots 보라색 자전거 달력 소나무'; // 캡처 전용 값
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SERVICE_ROLE = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role: 'service_role' })}.${'s'.repeat(43)}`;
const SHOP_DEV = [
  ['STRIPE', '_SECRET_KEY=sk', '_test_', 'a'.repeat(24)].join(''),
  'STRIPE_WEBHOOK_SECRET=whsec_devdevdevdevdevdevdevdev',
  ['OPENAI_API_KEY=sk-', 'proj-', 'b'.repeat(48)].join(''),
  'DATABASE_URL=postgres://dev:pw@localhost/shop',
  'SESSION_SECRET=dev-session-secret-value-0001',
];
const SHOP_PROD = [
  ['STRIPE', '_SECRET_KEY=sk', '_live_', 'c'.repeat(24)].join(''),
  ['NEXT_PUBLIC_STRIPE_KEY=pk', '_live_', 'd'.repeat(24)].join(''),
  `NEXT_PUBLIC_SUPABASE_KEY=${SERVICE_ROLE}`,
  'DATABASE_URL=postgres://prod:pw@db.example.com/shop',
  ['RESEND_API_KEY=re_', 'e'.repeat(30)].join(''),
];
const AI_LOG = [
  JSON.stringify({ at: new Date(Date.now() - 3 * 60_000).toISOString(), tool: 'run_with_keys', command: 'npm test -- webhook', keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], redacted: 1 }),
  JSON.stringify({ at: new Date(Date.now() - 2 * 60_000).toISOString(), tool: 'request_key', keys: ['RESEND_API_KEY'], env: 'dev' }),
].join('\n');

async function setupVault(page) {
  await page.goto(URL);
  await page.getByRole('button', { name: /새 금고 만들기/ }).click();
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  await page.getByRole('button', { name: '열쇠 만들기' }).click();
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  await page.getByRole('heading', { name: '프로젝트', exact: true }).waitFor();
}

async function importEnv(page, project, env, lines) {
  const top = page.locator('.list-top').getByRole('button', { name: '.env 넣기' });
  if (await top.count()) await top.first().click();
  else await page.getByRole('button', { name: '붙여 넣기' }).click();
  const dialog = page.getByRole('dialog', { name: '.env 넣기' });
  await dialog.getByPlaceholder('프로젝트 이름').fill(project);
  if (env) await dialog.locator('input.secret-env').nth(1).fill(env);
  await dialog.getByRole('textbox', { name: '.env 내용을 붙여 넣으세요' }).fill(lines.join('\n'));
  await dialog.getByRole('button', { name: /개 넣기/ }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function seed(page) {
  await importEnv(page, 'shop', 'dev', SHOP_DEV);
  await importEnv(page, 'shop', 'prod', SHOP_PROD);
  await importEnv(page, 'blog', 'dev', ['DATABASE_URL=postgres://blog:pw@localhost/blog', 'SENTRY_DSN=https://abc@o1.ingest.sentry.io/1']);
  await importEnv(page, '개인 계정', '', ['GITHUB_TOKEN=' + ['gh', 'p_', 'f'.repeat(36)].join(''), 'AWS_REGION=ap-northeast-2']);
  await page.waitForTimeout(6500); // 넣기 알림이 사라진 뒤에 찍는다
}

const shot = (page, name) => page.screenshot({ path: join(out, `${scheme}-${name}.png`) });
// 폴더 고르기 창 대신 브라우저 전용 저장소(OPFS)의 폴더를 돌려준다 (addInitScript는 함수 글자만 보내므로 이름은 인자로 넘긴다)
const fakeFolder = (page, name) =>
  page.addInitScript((n) => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(n, { create: true });
  }, name);

const browser = await chromium.launch({ channel: 'chrome' });
// ---- PC ----
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await fakeFolder(page, 'shop');
  await page.goto(URL);
  await shot(page, 'pc-0-setup');
  await setupVault(page);
  await shot(page, 'pc-1-empty');
  await seed(page);
  await page.locator('.sidebar').getByRole('button', { name: '모든 프로젝트' }).click();
  await shot(page, 'pc-2-projects');
  await page.locator('.attention-strip').getByRole('button', { name: '보기' }).click();
  await shot(page, 'pc-3-attention');
  await page.locator('.sidebar').getByRole('button', { name: /^shop/ }).click();
  await page.locator('.key-row', { hasText: 'STRIPE_SECRET_KEY' }).first().locator('.key-main').click();
  await page.locator('.secret-places').getByRole('button', { name: '+ 추가' }).click();
  await page.getByRole('alertdialog').getByLabel('기기나 서비스 이름 (예: 맥북, Vercel)').fill('Vercel');
  await page.getByRole('alertdialog').getByRole('button', { name: '추가' }).click();
  await shot(page, 'pc-4-project-keys');
  await page.getByRole('group', { name: '보기 방식' }).getByRole('button', { name: '환경 비교' }).click();
  await page.locator('[aria-label="닫기"]').click().catch(() => undefined);
  await shot(page, 'pc-5-compare');
  // 연결 탭: 가짜 폴더에 깃 HEAD와 AI 기록을 넣어 둔다
  await page.evaluate(async (log) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop', { create: true });
    const put = async (dir, name, text) => {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    };
    await put(await root.getDirectoryHandle('.git', { create: true }), 'HEAD', 'ref: refs/heads/feature/pay\n');
    await put(await root.getDirectoryHandle('.vault', { create: true }), 'ai-log.jsonl', log);
  }, AI_LOG);
  await page.getByRole('tab', { name: '연결' }).click();
  await shot(page, 'pc-6-connect-empty');
  await page.getByRole('button', { name: '폴더 고르기' }).click();
  await page.getByRole('button', { name: '파일 비밀번호 정하기' }).click();
  await page.getByRole('alertdialog').getByLabel('파일 비밀번호').fill('shots file passphrase');
  await page.getByRole('alertdialog').getByRole('button', { name: '저장' }).click();
  await page.getByText('키 파일 2개를 썼습니다.').waitFor();
  await page.getByRole('button', { name: '.vault.yml 만들기' }).click();
  await page.getByText('.vault.yml을 만들었습니다.').waitFor();
  await page.waitForTimeout(6500); // 알림이 사라진 뒤
  await shot(page, 'pc-7-connect');
  await page.locator('.sidebar').getByRole('button', { name: '찾아서 복사' }).click();
  await page.getByPlaceholder('키 이름으로 찾기 또는 명령…').fill('stripe');
  await shot(page, 'pc-8-palette');
  await page.keyboard.press('Escape');
  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await shot(page, 'pc-9-settings');
  await page.getByRole('button', { name: '프로젝트로 돌아가기' }).click();
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await page.locator('#pw').fill('틀린 비밀번호입니다');
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await page.getByText('비밀번호가 틀렸습니다').waitFor();
  await shot(page, 'pc-10-unlock-error');
  await ctx.close();
}
// ---- PC: 동기화가 멈췄을 때 (폴더 권한이 풀림) ----
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await fakeFolder(page, 'sync');
  // 권한이 풀린 것처럼: 표시를 켜면 폴더 권한 확인이 'prompt'를 돌려준다
  await page.addInitScript(() => {
    const q = FileSystemHandle.prototype.queryPermission;
    FileSystemHandle.prototype.queryPermission = async function (d) {
      return localStorage.getItem('shots.revoked') ? 'prompt' : q ? q.call(this, d) : 'granted';
    };
  });
  await setupVault(page);
  await importEnv(page, 'shop', 'prod', SHOP_PROD.slice(0, 2));
  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await page.locator('.sync-card', { hasText: '내 컴퓨터의 폴더' }).getByRole('button', { name: '동기화 폴더 고르기' }).click();
  await page.locator('#pw').fill(PASSWORD);
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await page.locator('.sidebar .badge').filter({ hasText: '동기화됨' }).waitFor();
  await page.evaluate(() => localStorage.setItem('shots.revoked', '1'));
  await page.getByLabel('빠른 추가').fill('NEW_KEY=changed-while-offline');
  await page.getByLabel('빠른 추가').press('Enter');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.sync-stopped').waitFor();
  await page.locator('.key-row').first().locator('.key-main').click();
  await shot(page, 'pc-11-sync-stopped');
  await ctx.close();
}
// ---- 모바일 ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: 'ko-KR', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.getByRole('button', { name: /새 금고 만들기/ }).click();
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  await shot(page, 'm-0-setup');
  await page.getByRole('button', { name: '열쇠 만들기' }).click();
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  await page.getByRole('heading', { name: '프로젝트', exact: true }).waitFor();
  await shot(page, 'm-1-empty');
  await seed(page);
  await page.getByRole('button', { name: '프로젝트 목록으로' }).click();
  await shot(page, 'm-2-projects');
  await page.getByRole('button', { name: 'shop 열기' }).click();
  await shot(page, 'm-3-project');
  await page.locator('.key-row', { hasText: 'STRIPE_SECRET_KEY' }).first().locator('.key-main').click();
  await shot(page, 'm-4-key');
  await page.getByRole('button', { name: '목록으로' }).click();
  await page.getByRole('tab', { name: '연결' }).click();
  await shot(page, 'm-5-connect');
  await ctx.close();
}
await browser.close();
console.log('saved to', out);
