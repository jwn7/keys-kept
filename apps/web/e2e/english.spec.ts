import { expect, test } from '@playwright/test';

// 테스트 전용 값. 실제 비밀번호가 아니다.
const PASSWORD = 'e2e purple bicycle calendar pinetree';

/**
 * 영어 화면. 다른 테스트는 설정 파일의 ko-KR로 돌고, 여기서만 브라우저 언어가 영어인 새 컨텍스트를 연다.
 * 언어는 저장된 선택(vault.lang) → 브라우저 언어 순으로 정해진다 (src/i18n/ko.ts).
 */
test('브라우저 언어가 영어면 처음 설정과 메인 화면이 영어로 나오고, 설정에서 한국어로 바꿀 수 있다', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/');

  // 처음 설정
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'First-time setup' })).toBeVisible();
  await expect(page.getByText('마스터 비밀번호')).toHaveCount(0);
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  const create = page.getByRole('button', { name: 'Create vault key' });
  await expect(create).toBeEnabled(); // zxcvbn 사전을 받은 뒤에 켜진다
  await create.click();
  await expect(page.locator('.phrase-grid span')).toHaveCount(12);
  await page.getByRole('button', { name: 'I wrote it down' }).click();

  // 메인: 빈 프로젝트 목록
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Drop the .env file you use here' })).toBeVisible();
  await expect(page.locator('.sidebar .badge')).toHaveText('Local only');
  await expect(page.locator('.sidebar').getByRole('button', { name: 'All projects' })).toBeVisible();
  await page.locator('.list-title-row').getByRole('button', { name: 'New project' }).click();
  await page.getByRole('alertdialog').getByLabel('Project name (e.g. shop)').fill('shop');
  await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click();
  const quick = page.getByLabel('Quick add');
  await quick.fill('STAGING_KEY=staging-value-123');
  await quick.press('Enter');
  await expect(page.locator('.key-row', { hasText: 'STAGING_KEY' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Keys 1' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Connect' })).toBeVisible();

  // 설정에서 한국어로 → 새로 고쳐져 잠금 화면이 한국어로 나온다
  await page.locator('.sidebar').getByRole('button', { name: 'Settings' }).click();
  const language = page.getByRole('group', { name: 'Language' });
  await expect(language.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  await language.getByRole('button', { name: '한국어' }).click();
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  expect(await page.evaluate(() => localStorage.getItem('vault.lang'))).toBe('ko');

  await ctx.close();
});
