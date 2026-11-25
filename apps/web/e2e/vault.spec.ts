import { expect, test, type Page } from '@playwright/test';

// 테스트 전용 값. 실제 비밀번호가 아니다.
const PASSWORD = 'e2e 보라색 자전거 달력 소나무';

async function setup(page: Page) {
  await page.goto('/');
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  const create = page.getByRole('button', { name: '열쇠 만들기' });
  await expect(create).toBeEnabled(); // zxcvbn 사전을 받은 뒤에 켜진다
  await create.click();
  await expect(page.locator('.phrase-grid span')).toHaveCount(12);
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  await expect(page.getByRole('heading', { name: '모든 메모' })).toBeVisible();
}

async function unlock(page: Page, password = PASSWORD) {
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: '열기', exact: true }).click();
}

test('처음 설정 → 복구 키 12단어 → 메인', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.sidebar .badge')).toHaveText('로컬 전용');
});

test('약한 비밀번호로는 열쇠를 만들 수 없다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pw').fill('password1234');
  await page.locator('#pw2').fill('password1234');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: '열쇠 만들기' })).toBeDisabled();
});

test('쓰자마자 잠가도 내용이 남는다 (잠그기 전 저장)', async ({ page }) => {
  await setup(page);
  await page.locator('.list-title-row').getByRole('button', { name: '새 메모' }).click();
  await page.getByLabel('메모 제목').fill('잠금 테스트');
  await page.locator('.cm-content').click();
  await page.keyboard.type('디바운스를 기다리지 않고 저장돼야 한다');
  await page.getByRole('button', { name: '잠금', exact: true }).click(); // 1초 디바운스 전에 잠근다
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();

  await unlock(page);
  await page.locator('.note-row', { hasText: '잠금 테스트' }).click();
  await expect(page.locator('.cm-content')).toContainText('디바운스를 기다리지 않고 저장돼야 한다');
});

test('틀린 비밀번호는 거절하고 안내한다', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await unlock(page, '틀린 비밀번호');
  await expect(page.getByText('비밀번호가 틀렸습니다')).toBeVisible();
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();
});

test('빠른 메모 → 목록, 여러 단어 검색', async ({ page }) => {
  await setup(page);
  const quick = page.getByLabel('빠른 메모');
  for (const t of ['주간 회의 준비', '장보기 우유', '배포 회의 체크']) {
    await quick.fill(t);
    await quick.press('Enter');
  }
  await expect(page.locator('.note-row')).toHaveCount(3);

  await page.locator('.sidebar').getByRole('button', { name: '검색과 명령' }).click();
  await page.getByPlaceholder('메모 검색 또는 명령…').fill('회의 배포');
  const items = page.locator('.palette-item', { hasText: '회의' });
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('배포 회의 체크');
});

test('캘린더에서 날을 고르고 빠른 메모를 넣으면 그 날짜에 놓인다', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '캘린더', exact: true }).click();
  const cell = page.locator('.cal-cell:not(.out)').nth(14); // 이번 달 15일
  await cell.click();
  await page.getByLabel('빠른 메모').fill('치과 예약');
  await page.getByLabel('빠른 메모').press('Enter');
  await expect(cell.locator('.cal-dots i')).toHaveCount(1);
  await expect(page.locator('.agenda-day .note-row')).toHaveText('치과 예약');
  // 다시 잠갔다 열어도 날짜가 남는다 (암호문 안에 저장)
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await unlock(page);
  await page.locator('.cal-cell:not(.out)').nth(14).click();
  await expect(page.locator('.agenda-day .note-row')).toHaveText('치과 예약');
});

test('휴지통으로 보낸 뒤 되돌리기', async ({ page }) => {
  await setup(page);
  await page.getByLabel('빠른 메모').fill('지울 메모');
  await page.getByLabel('빠른 메모').press('Enter');
  await page.locator('.note-row', { hasText: '지울 메모' }).click();
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '휴지통으로' }).click();
  await expect(page.locator('.note-row')).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('.note-row', { hasText: '지울 메모' })).toBeVisible();
});
