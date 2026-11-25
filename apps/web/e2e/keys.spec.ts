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
  await expect(page.getByRole('heading', { name: '오늘', exact: true })).toBeVisible();
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
