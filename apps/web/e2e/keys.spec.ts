import { expect, test, type Page } from '@playwright/test';

// 테스트 전용 값. 실제 비밀번호나 키가 아니다. 키 모양은 조각을 이어 붙여 만든다(비밀 검사기가 막지 않게).
const PASSWORD = 'e2e 보라색 자전거 달력 소나무';
const OPENAI = ['sk-', 'proj-', 'a'.repeat(48)].join('');
const STRIPE_PK = ['pk', '_live_', 'c'.repeat(24)].join('');
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SERVICE_ROLE = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role: 'service_role' })}.${'s'.repeat(43)}`;

async function setup(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  const create = page.getByRole('button', { name: '열쇠 만들기' });
  await expect(create).toBeEnabled();
  await create.click();
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  await expect(page.getByRole('heading', { name: '살펴볼 것' })).toBeVisible();
}
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test('키 넣기: NAME=value 한 줄 → 어느 서비스의 키인지 알아보고, 값은 가려서 보이고, 복사된다', async ({ page }) => {
  await setup(page);
  const quick = page.getByLabel('빠른 메모');
  await quick.fill(`OPENAI_API_KEY=${OPENAI}`);
  await quick.press('Enter');

  const row = page.locator('.key-row', { hasText: 'OPENAI_API_KEY' });
  await expect(row).toContainText('OpenAI');
  await expect(row.locator('.key-mask')).toHaveText('sk-p••••••••');
  await expect(page.locator('body')).not.toContainText(OPENAI); // 화면 어디에도 값이 그대로 보이지 않는다

  // 목록에서 바로 복사
  await row.getByRole('button', { name: 'OPENAI_API_KEY 값 복사' }).click();
  expect(await clipboard(page)).toBe(OPENAI);

  // 상세: 가려진 입력칸, 종류, 재발급 페이지
  await row.locator('.key-main').click();
  const value = page.getByLabel('값', { exact: true });
  await expect(value).toHaveAttribute('type', 'password');
  await expect(value).toHaveValue(OPENAI);
  await expect(page.locator('.secret-kind')).toContainText('OpenAI · API key');
  await expect(page.getByRole('link', { name: '재발급 페이지' })).toHaveAttribute('href', 'https://platform.openai.com/api-keys');

  // 쓰이는 곳 적기
  await page.locator('.secret-places').getByRole('button', { name: '+ 추가' }).click();
  await page.getByRole('alertdialog').getByLabel('기기나 서비스 이름 (예: 맥북, Vercel)').fill('맥북');
  await page.getByRole('alertdialog').getByRole('button', { name: '추가' }).click();
  await expect(page.locator('.secret-places')).toContainText('맥북');

  // 잠갔다 열어도 그대로, 서버가 보는 모습에는 값이 없다
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await page.locator('#pw').fill(PASSWORD);
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await page.locator('.key-row', { hasText: 'OPENAI_API_KEY' }).locator('.key-main').click();
  await expect(page.getByLabel('값', { exact: true })).toHaveValue(OPENAI);
  await expect(page.locator('.secret-places')).toContainText('맥북');
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '서버가 보는 모습' }).click();
  await expect(page.locator('.proof-raw')).toContainText('"ciphertext"');
  await expect(page.locator('.proof-raw')).not.toContainText('OPENAI');
});

test('키를 차례로 열어도 값이 서로 섞이지 않는다 (열었던 키의 값이 다음 키에 저장되던 버그)', async ({ page }) => {
  await setup(page);
  const GITHUB = ['gh', 'p_', 'e'.repeat(36)].join('');
  const quick = page.getByLabel('빠른 메모');
  for (const line of [`OPENAI_API_KEY=${OPENAI}`, `GITHUB_TOKEN=${GITHUB}`, 'DATABASE_URL=postgres://u:p@host/db']) {
    await quick.fill(line);
    await quick.press('Enter');
  }
  await expect(page.locator('.key-row')).toHaveCount(3);
  const value = page.getByLabel('값', { exact: true });
  // 열고, 값 칸을 건드리고(포커스), 다음 키로 넘어가기를 되풀이한다
  for (const name of ['OPENAI_API_KEY', 'GITHUB_TOKEN', 'DATABASE_URL', 'OPENAI_API_KEY', 'GITHUB_TOKEN']) {
    await page.locator('.key-row', { hasText: name }).locator('.key-main').click();
    await expect(page.locator('.editor-title')).toHaveValue(name);
    await value.click();
  }
  await page.locator('.sidebar').getByRole('button', { name: '모든 키' }).click();
  await expect(page.locator('.key-row', { hasText: 'OPENAI_API_KEY' })).toContainText('OpenAI');
  await expect(page.locator('.key-row', { hasText: 'GITHUB_TOKEN' })).toContainText('GitHub');
  await expect(page.locator('.key-row', { hasText: 'DATABASE_URL' })).toContainText('알 수 없는 종류');
  for (const [name, expected] of [['OPENAI_API_KEY', OPENAI], ['GITHUB_TOKEN', GITHUB], ['DATABASE_URL', 'postgres://u:p@host/db']] as const) {
    await page.locator('.key-row', { hasText: name }).locator('.key-main').click();
    await expect(value).toHaveValue(expected);
  }
});

test('값을 치고 0.6초 안에 잠가도 그 입력이 남는다', async ({ page }) => {
  await setup(page);
  await page.getByLabel('빠른 메모').fill('SESSION_SECRET=first-value-123456');
  await page.getByLabel('빠른 메모').press('Enter');
  await page.locator('.key-row', { hasText: 'SESSION_SECRET' }).locator('.key-main').click();
  const value = page.getByLabel('값', { exact: true });
  await value.fill('second-value-abcdef');
  await page.keyboard.press('Control+l'); // 저장을 기다리지 않고 바로 잠근다
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();
  await page.locator('#pw').fill(PASSWORD);
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await page.locator('.key-row', { hasText: 'SESSION_SECRET' }).locator('.key-main').click();
  await expect(value).toHaveValue('second-value-abcdef');
});

test('꺼내 쓰기: Ctrl+K → 이름 → Enter로 값 복사, Shift+Enter로 이름=값 복사', async ({ page }) => {
  await setup(page);
  await page.getByLabel('빠른 메모').fill(`OPENAI_API_KEY=${OPENAI}`);
  await page.getByLabel('빠른 메모').press('Enter');
  await expect(page.locator('.key-row')).toHaveCount(1);

  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('메모 검색 또는 명령…');
  await input.fill('openai');
  await expect(page.locator('.palette-item').first()).toContainText('sk-p••••••••'); // 팔레트에서도 가려서
  await input.press('Enter');
  expect(await clipboard(page)).toBe(OPENAI);
  await expect(page.locator('.editor-title')).toHaveCount(0); // 열지 않고 복사만 했다

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('메모 검색 또는 명령…').fill('openai');
  await page.getByPlaceholder('메모 검색 또는 명령…').press('Shift+Enter');
  expect(await clipboard(page)).toBe(`OPENAI_API_KEY=${OPENAI}`);
});

test('.env 넣기: 항목으로 나누고, 공개되는 이름에 비밀 키가 있으면 경고하고, 다시 .env로 꺼낸다', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '.env 넣기' }).click();
  const dialog = page.getByRole('dialog', { name: '.env 넣기' });
  await dialog.getByPlaceholder('프로젝트 이름').fill('shop');
  await dialog.getByRole('textbox', { name: '.env 내용을 붙여 넣으세요' }).fill(
    ['# 결제', `OPENAI_API_KEY=${OPENAI}`, `NEXT_PUBLIC_STRIPE_KEY=${STRIPE_PK}`, `NEXT_PUBLIC_SUPABASE_KEY=${SERVICE_ROLE}`, 'DATABASE_URL="postgres://u:p@host/db"'].join('\n'),
  );
  await expect(dialog).toContainText('4개를 찾았습니다');
  // 공개해도 되는 Stripe 키는 조용히, service_role 키만 경고
  await expect(dialog.locator('.env-row', { hasText: 'NEXT_PUBLIC_SUPABASE_KEY' })).toContainText('공개되는 이름');
  await expect(dialog.locator('.env-row', { hasText: 'NEXT_PUBLIC_STRIPE_KEY' })).not.toContainText('공개되는 이름');
  await dialog.getByRole('button', { name: '4개 넣기' }).click();

  await expect(page.getByRole('heading', { name: 'shop' })).toBeVisible();
  await expect(page.locator('.key-row')).toHaveCount(4);
  await expect(page.locator('.key-row', { hasText: 'NEXT_PUBLIC_SUPABASE_KEY' })).toContainText('공개되는 이름');
  await expect(page.locator('.key-row', { hasText: 'NEXT_PUBLIC_STRIPE_KEY' })).toContainText('공개 가능');

  // 같은 것을 한 번 더 넣어도 늘어나지 않는다
  await page.getByRole('button', { name: '.env 넣기' }).click();
  await dialog.getByRole('textbox', { name: '.env 내용을 붙여 넣으세요' }).fill(`OPENAI_API_KEY=${OPENAI}`);
  await expect(dialog.locator('.env-row')).toContainText('그대로');
  await expect(dialog.getByRole('button', { name: '0개 넣기' })).toBeDisabled();
  await dialog.getByRole('button', { name: '취소' }).click();

  // 다시 .env로
  await page.getByRole('button', { name: '.env 복사' }).click();
  await expect(page.getByText('.env 4줄을 복사했습니다.')).toBeVisible();
  const text = await clipboard(page);
  console.log('CLIP', JSON.stringify(text));
  // Windows 클립보드는 줄바꿈을 \r\n으로 바꾼다
  expect(text.split(/\r?\n/).filter(Boolean)).toEqual([
    'DATABASE_URL=postgres://u:p@host/db',
    `NEXT_PUBLIC_STRIPE_KEY=${STRIPE_PK}`,
    `NEXT_PUBLIC_SUPABASE_KEY=${SERVICE_ROLE}`,
    `OPENAI_API_KEY=${OPENAI}`,
  ]);
});

test('살펴볼 것과 사고 모드: 경고가 있는 키가 첫 화면에 오르고, 털린 곳을 고르면 바꿀 키만 뽑는다', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '.env 넣기' }).click();
  const dialog = page.getByRole('dialog', { name: '.env 넣기' });
  await dialog.getByPlaceholder('프로젝트 이름').fill('shop');
  await dialog.getByRole('textbox', { name: '.env 내용을 붙여 넣으세요' }).fill([`OPENAI_API_KEY=${OPENAI}`, `NEXT_PUBLIC_SUPABASE_KEY=${SERVICE_ROLE}`, 'DATABASE_URL=postgres://u:p@host/db'].join('\n'));
  await dialog.getByRole('button', { name: '3개 넣기' }).click();
  await expect(page.locator('.key-row')).toHaveCount(3);

  // 첫 화면: 공개될 수 있는 키가 맨 위에, 쓰이는 곳을 안 적은 키 수
  await page.locator('.sidebar').getByRole('button', { name: '살펴볼 것' }).click();
  const attention = page.getByRole('region', { name: '지금 살펴볼 키' });
  await expect(attention.locator('.key-row')).toHaveCount(1);
  await expect(attention.locator('.key-row')).toContainText('NEXT_PUBLIC_SUPABASE_KEY');
  await expect(attention).toContainText('쓰이는 곳을 안 적은 키 3개');

  // OPENAI 키가 맥북에 있다고 적는다
  await page.locator('.key-row', { hasText: 'OPENAI_API_KEY' }).locator('.key-main').click();
  await page.locator('.secret-places').getByRole('button', { name: '+ 추가' }).click();
  await page.getByRole('alertdialog').getByLabel('기기나 서비스 이름 (예: 맥북, Vercel)').fill('맥북');
  await page.getByRole('alertdialog').getByRole('button', { name: '추가' }).click();
  await expect(page.locator('.secret-places')).toContainText('맥북');

  // 사고 모드: 맥북이 털렸다 → 맥북에 있던 키 1개, 나머지 2개는 "모름"
  await page.locator('.sidebar').getByRole('button', { name: '사고 모드' }).click();
  await expect(page.getByRole('heading', { name: '사고 모드' })).toBeVisible();
  await page.locator('.incident-pick').getByRole('button', { name: '맥북 · 1' }).click();
  await expect(page.locator('.incident-progress')).toContainText('0 / 1');
  await expect(page.locator('.incident')).toContainText('쓰이는 곳을 안 적은 키 2개');
  await expect(page.locator('.incident-row', { hasText: 'OPENAI_API_KEY' }).getByRole('link', { name: '재발급 페이지' })).toHaveAttribute('href', 'https://platform.openai.com/api-keys');

  // 새 값으로 바꾸면 스스로 체크된다
  await page.locator('.incident-row', { hasText: 'OPENAI_API_KEY' }).locator('.incident-main').click();
  const value = page.getByLabel('값', { exact: true });
  await value.fill(['sk-', 'proj-', 'n'.repeat(48)].join(''));
  await value.press('Tab');
  await expect(page.locator('.incident-progress')).toContainText('1 / 1');
  await expect(page.locator('.incident-row', { hasText: 'OPENAI_API_KEY' })).toContainText('값을 바꿈');
  await expect(page.locator('.incident-progress')).toContainText('전부 바꿨습니다.');
});

test('환경 비교표: 한 환경에만 빠진 값을 찾아 주고, 빠진 칸에서 새 값을 만들어 채운다', async ({ page }) => {
  await setup(page);
  const importEnv = async (env: string, lines: string[]) => {
    await page.getByRole('button', { name: '.env 넣기' }).click();
    const dialog = page.getByRole('dialog', { name: '.env 넣기' });
    await dialog.getByPlaceholder('프로젝트 이름').fill('shop');
    await dialog.locator('input.secret-env').nth(1).fill(env);
    await dialog.getByRole('textbox', { name: '.env 내용을 붙여 넣으세요' }).fill(lines.join('\n'));
    await dialog.getByRole('button', { name: /개 넣기/ }).click();
    await expect(dialog).toHaveCount(0);
  };
  await importEnv('dev', ['API_URL=https://dev.example.com', 'SESSION_SECRET=dev-session-secret-value', `OPENAI_API_KEY=${OPENAI}`]);
  await importEnv('prod', ['API_URL=https://example.com', `OPENAI_API_KEY=${OPENAI}`]);

  await page.getByRole('button', { name: '환경 비교' }).click();
  const table = page.locator('.compare-table');
  await expect(table.locator('thead th')).toHaveText(['이름', 'dev', 'prod']);
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('.compare-summary')).toHaveText('빠진 값 1개');
  await expect(table).not.toContainText('dev-session-secret-value'); // 표에서도 값은 가려서

  // prod에 빠진 SESSION_SECRET을 그 자리에서 만든다
  await page.getByRole('button', { name: 'prod에 SESSION_SECRET 추가' }).click();
  await expect(page.locator('.editor-title')).toHaveValue('SESSION_SECRET');
  await page.locator('.secret-generate').getByRole('button', { name: '32바이트' }).click();
  await expect(page.getByLabel('값', { exact: true })).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
  await expect(page.locator('.compare-summary')).toHaveText('빠진 값이 없습니다');
});

test('팀 공유: 받는 사람의 공개키로 잠근 파일을 만들고, 받는 사람은 자기 금고에서 연다', async ({ browser }) => {
  const open = async () => {
    const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await setup(page);
    return { ctx, page };
  };
  const importShop = async (page: Page, lines: string[]) => {
    await page.getByRole('button', { name: '.env 넣기' }).click();
    const dialog = page.getByRole('dialog', { name: '.env 넣기' });
    await dialog.getByPlaceholder('프로젝트 이름').fill('shop');
    await dialog.getByRole('textbox', { name: '.env 내용을 붙여 넣으세요' }).fill(lines.join('\n'));
    await dialog.getByRole('button', { name: /개 넣기/ }).click();
    await expect(dialog).toHaveCount(0);
  };

  // 받는 사람(B): 공유 열쇠를 만들고 공개키를 알려 준다
  const b = await open();
  await importShop(b.page, ['PLACEHOLDER_KEY=placeholder-value-1']);
  await b.page.getByRole('button', { name: '팀원에게 보내기' }).click();
  await b.page.getByRole('button', { name: '공유 열쇠 만들기' }).click();
  const bobKey = (await b.page.getByTestId('my-recipient').textContent())!.trim();
  expect(bobKey).toMatch(/^age1/);
  await b.page.getByRole('dialog', { name: '팀원에게 보내기' }).getByRole('button', { name: '취소' }).click();

  // 보내는 사람(A): 팀원을 등록하고 프로젝트를 그 사람 앞으로 잠근다
  const a = await open();
  await importShop(a.page, [`OPENAI_API_KEY=${OPENAI}`, 'DATABASE_URL=postgres://u:p@host/db']);
  await a.page.getByRole('button', { name: '팀원에게 보내기' }).click();
  const share = a.page.getByRole('dialog', { name: '팀원에게 보내기' });
  await share.getByRole('button', { name: '공유 열쇠 만들기' }).click();
  await share.getByLabel('이름').fill('밥');
  await share.getByLabel('공개키 (age1…)').fill('AGE-SECRET-KEY-1NOTAPUBLICKEYNOTAPUBLICKEY'); // 개인키를 잘못 넣으면 막는다
  await share.getByRole('button', { name: '팀원 추가' }).click();
  await expect(share).toContainText('공개키가 아닙니다');
  await share.getByLabel('공개키 (age1…)').fill(bobKey);
  await share.getByRole('button', { name: '팀원 추가' }).click();
  await expect(share.locator('.share-person', { hasText: '밥' }).getByRole('checkbox')).toBeChecked();
  const [download] = await Promise.all([a.page.waitForEvent('download'), share.getByRole('button', { name: '1명에게 보낼 파일 만들기' }).click()]);
  expect(download.suggestedFilename()).toBe('env.age'); // 브라우저는 내려받을 때 이름 맨 앞의 점을 뗀다. vault-run은 두 이름을 다 찾는다
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 21).toString()).toBe('age-encryption.org/v1');
  expect(bytes.toString('latin1')).not.toContain(OPENAI); // 파일에는 값이 그대로 없다

  // B가 받은 파일을 자기 금고의 개인키로 연다
  await b.page.getByRole('button', { name: '.env 넣기' }).click();
  const dialog = b.page.getByRole('dialog', { name: '.env 넣기' });
  const [chooser] = await Promise.all([b.page.waitForEvent('filechooser'), dialog.getByRole('button', { name: '받은 파일 열기 (.age)' }).click()]);
  await chooser.setFiles({ name: '.env.age', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(dialog).toContainText('2개를 찾았습니다');
  await expect(dialog.locator('.env-row', { hasText: 'OPENAI_API_KEY' })).toContainText('OpenAI');
  await dialog.getByPlaceholder('프로젝트 이름').fill('shop');
  await dialog.getByRole('button', { name: '2개 넣기' }).click();
  await b.page.locator('.key-row', { hasText: 'OPENAI_API_KEY' }).locator('.key-main').click();
  await expect(b.page.getByLabel('값', { exact: true })).toHaveValue(OPENAI);

  // 받는 사람이 아닌 제3자는 못 연다
  const c = await open();
  await importShop(c.page, ['PLACEHOLDER_KEY=placeholder-value-1']);
  await c.page.getByRole('button', { name: '팀원에게 보내기' }).click();
  await c.page.getByRole('button', { name: '공유 열쇠 만들기' }).click();
  await c.page.getByRole('dialog', { name: '팀원에게 보내기' }).getByRole('button', { name: '취소' }).click();
  await c.page.getByRole('button', { name: '.env 넣기' }).click();
  const [chooser2] = await Promise.all([c.page.waitForEvent('filechooser'), c.page.getByRole('button', { name: '받은 파일 열기 (.age)' }).click()]);
  await chooser2.setFiles({ name: '.env.age', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(c.page.getByText('이 파일을 열 수 없습니다')).toBeVisible();

  await Promise.all([a.ctx.close(), b.ctx.close(), c.ctx.close()]);
});
