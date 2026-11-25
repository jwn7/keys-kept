import { expect, test, type Page } from '@playwright/test';

// 테스트 전용 값. 실제 비밀번호가 아니다.
const PASSWORD = 'e2e 보라색 자전거 달력 소나무';

async function setup(page: Page) {
  await page.goto('/');
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  const create = page.getByRole('button', { name: '열쇠 만들기' });
  await expect(create).toBeEnabled();
  await create.click();
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  await expect(page.getByRole('heading', { name: '모든 메모' })).toBeVisible();
}

test('패스키로 잠금 해제 (가상 인증기, WebAuthn PRF)', async ({ page }) => {
  // 지문 센서 대신 Chrome의 가상 인증기를 붙인다. 사용자 확인은 자동으로 통과한다.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });

  await setup(page);
  await page.getByLabel('빠른 메모').fill('패스키로 열릴 메모');
  await page.getByLabel('빠른 메모').press('Enter');

  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  const toggle = page.getByRole('switch', { name: '지문이나 Windows Hello로 열기' });
  await expect(toggle).toBeEnabled();
  await toggle.click(); // 인증이 끝난 뒤에 켜지므로 check()가 아니라 click 후 안내를 기다린다
  await expect(page.getByText('켰습니다. 다음부터 잠금 화면에서 쓸 수 있습니다.')).toBeVisible();
  await expect(toggle).toBeChecked();

  await page.getByRole('button', { name: '메모로 돌아가기' }).click();
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();

  // 비밀번호를 치지 않고 연다
  await page.getByRole('button', { name: '지문이나 Windows Hello로 열기' }).click();
  await expect(page.locator('.note-row', { hasText: '패스키로 열릴 메모' })).toBeVisible();

  // 끄면 잠금 화면에서 버튼이 사라진다
  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await page.getByRole('switch', { name: '지문이나 Windows Hello로 열기' }).click();
  await expect(page.getByText('껐습니다. 비밀번호로만 엽니다.')).toBeVisible();
  await page.getByRole('button', { name: '메모로 돌아가기' }).click();
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await expect(page.getByRole('button', { name: '지문이나 Windows Hello로 열기' })).toHaveCount(0);
});

test('자동 백업: 고른 폴더에 age 파일을 쓴다 (브라우저 안 가상 폴더)', async ({ page }) => {
  // 폴더 고르기 창은 사람이 눌러야 해서, 브라우저 전용 저장소(OPFS)의 폴더를 대신 돌려준다.
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('backups', { create: true });
  });
  await setup(page);
  await page.getByLabel('빠른 메모').fill('백업될 메모');
  await page.getByLabel('빠른 메모').press('Enter');

  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await page.getByRole('button', { name: '폴더 고르기' }).click();
  await page.getByRole('alertdialog').getByLabel('백업 비밀번호').fill('e2e 백업 비밀번호');
  await page.getByRole('alertdialog').getByRole('button', { name: '폴더 고르기' }).click();
  await expect(page.getByText('backups 폴더에 하루 한 번 저장합니다.')).toBeVisible();
  await expect(page.getByText('자동 백업을 켰습니다.')).toBeVisible(); // 첫 백업 파일을 다 쓴 뒤에 뜬다

  const files = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('backups');
    const out: { name: string; size: number; head: string }[] = [];
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) {
      const f = await h.getFile();
      out.push({ name, size: f.size, head: (await f.slice(0, 21).text()) });
    }
    return out;
  });
  expect(files).toHaveLength(1);
  expect(files[0]!.name).toMatch(/^vault-\d{4}-\d{2}-\d{2}\.age$/);
  expect(files[0]!.head).toBe('age-encryption.org/v1'); // 표준 age 파일
  expect(files[0]!.size).toBeGreaterThan(200);

  // 비밀번호는 평문으로 저장되지 않는다
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain('e2e 백업 비밀번호');
});
