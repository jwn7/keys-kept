import { expect, type Page } from '@playwright/test';

// 테스트 전용 값. 실제 비밀번호가 아니다.
export const PASSWORD = 'e2e 보라색 자전거 달력 소나무';

/** 처음 설정 → 복구 키 12단어 → 첫 화면(빈 프로젝트 목록) */
export async function setup(page: Page, password = PASSWORD) {
  await page.goto('/');
  await page.getByRole('button', { name: /새 금고 만들기/ }).click();
  await page.locator('#pw').fill(password);
  await page.locator('#pw2').fill(password);
  const create = page.getByRole('button', { name: '열쇠 만들기' });
  await expect(create).toBeEnabled(); // zxcvbn 사전을 받은 뒤에 켜진다
  await create.click();
  await expect(page.locator('.phrase-grid span')).toHaveCount(12);
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  await expect(page.getByRole('heading', { name: '프로젝트', exact: true })).toBeVisible(); // 첫 화면
}

export async function unlock(page: Page, password = PASSWORD) {
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: '열기', exact: true }).click();
}

/** 새 프로젝트: 이름을 정하면 빈 프로젝트 화면이 열린다 */
export async function newProject(page: Page, name: string) {
  await page.locator('.list-title-row').getByRole('button', { name: '새 프로젝트' }).click();
  await page.getByRole('alertdialog').getByLabel('프로젝트 이름 (예: shop)').fill(name);
  await page.getByRole('alertdialog').getByRole('button', { name: '확인' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** .env 넣기 창을 연다. 빈 금고에서는 첫 화면의 "붙여 넣기", 그 밖에는 위쪽의 ".env 넣기" */
export async function openImport(page: Page) {
  const top = page.locator('.list-top').getByRole('button', { name: '.env 넣기' });
  if (await top.count()) await top.first().click();
  else await page.getByRole('button', { name: '붙여 넣기' }).click();
  return page.getByRole('dialog', { name: '.env 넣기' });
}

/** .env 글을 프로젝트(와 환경)로 넣는다 */
export async function importEnv(page: Page, project: string, lines: string[], env = '') {
  const dialog = await openImport(page);
  await dialog.getByPlaceholder('프로젝트 이름').fill(project);
  if (env) await dialog.locator('input.secret-env').nth(1).fill(env);
  await dialog.getByRole('textbox', { name: '.env 내용을 붙여 넣으세요' }).fill(lines.join('\n'));
  await dialog.getByRole('button', { name: /개 넣기/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: project, exact: true })).toBeVisible();
}
