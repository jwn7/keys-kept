import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

// 테스트 전용 값. 실제 비밀번호가 아니다.
const PASSWORD = 'e2e 보라색 자전거 달력 소나무';

/**
 * 가짜 Google Drive. 앱의 DriveBackend가 보내는 요청(files.list / get / create / multipart 업로드)에 답한다.
 * 두 브라우저 컨텍스트가 이 객체 하나를 같이 쓴다 = 같은 Google 계정의 Drive.
 */
class FakeDrive {
  files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; modifiedTime: string; content: string }>();
  private seq = 0;

  async attach(ctx: BrowserContext) {
    // Google 로그인 스크립트: 창을 띄우지 않고 바로 토큰을 주는 대역
    await ctx.route('https://accounts.google.com/gsi/client', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){setTimeout(function(){c.callback({access_token:'e2e-token',expires_in:3600})},10)}}},revoke:function(){}}}};`,
      }),
    );
    await ctx.route('https://www.googleapis.com/**', (route) => this.handle(route));
  }

  private json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (url.pathname === '/drive/v3/about') return this.json(route, { user: { emailAddress: 'e2e@example.com' } });
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') ?? '';
      let rows = [...this.files.values()];
      const name = /name\s*=\s*'([^']+)'/.exec(q)?.[1];
      if (name) rows = rows.filter((f) => f.name === name);
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      if (parent) rows = rows.filter((f) => f.parents.includes(parent));
      const mime = /mimeType\s*=\s*'([^']+)'/.exec(q)?.[1];
      if (mime) rows = rows.filter((f) => f.mimeType === mime);
      const mt = /modifiedTime\s*>\s*'([^']+)'/.exec(q)?.[1];
      if (mt) rows = rows.filter((f) => f.modifiedTime > mt);
      return this.json(route, { files: rows.map(({ id, name: n, mimeType, modifiedTime }) => ({ id, name: n, mimeType, modifiedTime })) });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && one) {
      const f = this.files.get(one[1]!);
      return f ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: f.content }) : this.json(route, { error: { code: 404 } }, 404);
    }
    if (method === 'POST' && url.pathname === '/drive/v3/files') {
      const meta = JSON.parse(req.postData() ?? '{}') as { name: string; mimeType: string; parents?: string[] };
      const id = `f${++this.seq}`;
      this.files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], modifiedTime: new Date().toISOString(), content: '' });
      return this.json(route, { id, name: meta.name });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const boundary = /boundary=(.+)$/.exec(req.headers()['content-type'] ?? '')?.[1] ?? '';
      const parts = (req.postData() ?? '').split(`--${boundary}`).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const meta = JSON.parse(parts[1] || '{}') as { name?: string; mimeType?: string; parents?: string[] };
      const content = parts[2] ?? '';
      if (method === 'POST') {
        const id = `f${++this.seq}`;
        this.files.set(id, { id, name: meta.name ?? '', mimeType: meta.mimeType ?? 'application/json', parents: meta.parents ?? [], modifiedTime: new Date().toISOString(), content });
        return this.json(route, { id });
      }
      const f = this.files.get(url.pathname.split('/').pop() ?? '');
      if (!f) return this.json(route, { error: { code: 404 } }, 404);
      f.content = content;
      f.modifiedTime = new Date().toISOString();
      return this.json(route, { id: f.id });
    }
    return this.json(route, { error: { code: 400, message: `unhandled ${method} ${url.pathname}` } }, 400);
  }
}

async function unlock(page: Page) {
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();
  await page.locator('#pw').fill(PASSWORD);
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '모든 메모' })).toBeVisible();
}
const synced = (page: Page) => expect(page.locator('.sidebar .badge')).toContainText('동기화됨');

test('두 기기: 로컬에서 시작 → Drive 연결 → 새 기기에서 같은 비밀번호로 불러오기 → 서로 반영', async ({ browser }) => {
  const drive = new FakeDrive();

  // ---- 기기 A: 로컬 전용으로 시작해서 메모를 쓰고, 나중에 Drive를 연결한다 ----
  const ctxA = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 800 } });
  await drive.attach(ctxA);
  const a = await ctxA.newPage();
  await a.goto('/');
  await a.locator('#pw').fill(PASSWORD);
  await a.locator('#pw2').fill(PASSWORD);
  await a.getByRole('button', { name: '열쇠 만들기' }).click();
  await a.getByRole('button', { name: '적어두었습니다' }).click();
  await a.getByLabel('빠른 메모').fill('첫 기기에서 쓴 메모');
  await a.getByLabel('빠른 메모').press('Enter');
  await a.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await a.getByRole('button', { name: 'Google Drive 연결' }).click(); // 연결 후 앱이 다시 로드된다
  await unlock(a);
  await synced(a);

  // 열쇠(vault.json)와 메모가 올라갔고, Drive에는 평문이 없다
  const names = [...drive.files.values()].map((f) => f.name);
  expect(names).toContain('vault.json');
  expect(names.filter((n) => n.endsWith('.enc'))).toHaveLength(1);
  const everything = [...drive.files.values()].map((f) => f.name + f.content).join('\n');
  expect(everything).not.toContain('첫 기기에서 쓴 메모');
  expect(everything).not.toContain(PASSWORD);

  // ---- 기기 B: 빈 브라우저. 새로 만들지 않고 Drive에서 불러온다 ----
  const ctxB = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 800 } });
  await drive.attach(ctxB);
  const b = await ctxB.newPage();
  await b.goto('/');
  await b.getByRole('button', { name: /Google Drive에서 불러오기/ }).click();
  await unlock(b); // 같은 비밀번호 → Drive의 감싼 열쇠가 풀린다
  await expect(b.locator('.note-row', { hasText: '첫 기기에서 쓴 메모' })).toBeVisible();

  // ---- B에서 쓴 메모가 A에 나타난다 ----
  await b.getByLabel('빠른 메모').fill('둘째 기기에서 쓴 메모');
  await b.getByLabel('빠른 메모').press('Enter');
  await expect.poll(() => [...drive.files.values()].filter((f) => f.name.endsWith('.enc')).length).toBe(2);
  await a.evaluate(() => window.dispatchEvent(new Event('focus'))); // 창으로 돌아오면 동기화한다
  await expect(a.locator('.note-row', { hasText: '둘째 기기에서 쓴 메모' })).toBeVisible();

  // 틀린 비밀번호로는 새 기기에서 못 연다
  const ctxC = await browser.newContext({ locale: 'ko-KR' });
  await drive.attach(ctxC);
  const c = await ctxC.newPage();
  await c.goto('/');
  await c.getByRole('button', { name: /Google Drive에서 불러오기/ }).click();
  await expect(c.getByRole('heading', { name: '잠금 해제' })).toBeVisible();
  await c.locator('#pw').fill('남의 비밀번호');
  await c.getByRole('button', { name: '열기', exact: true }).click();
  await expect(c.getByText('비밀번호가 틀렸습니다')).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
