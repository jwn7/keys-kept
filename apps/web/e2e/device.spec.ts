import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, newProject, setup } from './helpers';

async function addKey(page: Page, line: string) {
  await newProject(page, 'shop');
  await page.getByLabel('빠른 추가').fill(line);
  await page.getByLabel('빠른 추가').press('Enter');
  await expect(page.locator('.key-row')).toHaveCount(1);
}

test('패스키로 잠금 해제 (가상 인증기, WebAuthn PRF)', async ({ page }) => {
  // 지문 센서 대신 Chrome의 가상 인증기를 붙인다. 사용자 확인은 자동으로 통과한다.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });

  await setup(page);
  await addKey(page, 'PASSKEY_KEY=opened-with-passkey');

  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  const toggle = page.getByRole('switch', { name: '지문이나 Windows Hello로 열기' });
  await expect(toggle).toBeEnabled();
  await toggle.click(); // 인증이 끝난 뒤에 켜지므로 check()가 아니라 click 후 안내를 기다린다
  await expect(page.getByText('켰습니다. 다음부터 잠금 화면에서 쓸 수 있습니다.')).toBeVisible();
  await expect(toggle).toBeChecked();

  await page.getByRole('button', { name: '프로젝트로 돌아가기' }).click();
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();

  // 비밀번호를 치지 않고 연다
  await page.getByRole('button', { name: '지문이나 Windows Hello로 열기' }).click();
  await expect(page.locator('.key-row', { hasText: 'PASSKEY_KEY' })).toBeVisible();

  // 끄면 잠금 화면에서 버튼이 사라진다
  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await page.getByRole('switch', { name: '지문이나 Windows Hello로 열기' }).click();
  await expect(page.getByText('껐습니다. 비밀번호로만 엽니다.')).toBeVisible();
  await page.getByRole('button', { name: '프로젝트로 돌아가기' }).click();
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
  await addKey(page, 'BACKUP_KEY=backed-up-value');

  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await page.getByRole('button', { name: '폴더 고르기', exact: true }).click(); // '동기화 폴더 고르기'와 구분
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

test('폴더 동기화: 고른 폴더에 암호문만 쓴다 (브라우저 안 가상 폴더)', async ({ page }) => {
  // 폴더 고르기 창 대신 브라우저 전용 저장소(OPFS)의 폴더를 돌려준다
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('sync', { create: true });
  });
  await setup(page);
  await addKey(page, 'FOLDER_SYNC_KEY=folder-sync-secret-value');

  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await page.locator('.sync-card', { hasText: '내 컴퓨터의 폴더' }).getByRole('button', { name: '동기화 폴더 고르기' }).click(); // 연결 후 앱이 다시 로드된다
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();
  await page.locator('#pw').fill(PASSWORD);
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await expect(page.locator('.sidebar .badge')).toContainText('동기화됨');

  const files = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sync');
    const out: { name: string; text: string }[] = [];
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) out.push({ name, text: await (await h.getFile()).text() });
    return out;
  });
  const names = files.map((f) => f.name);
  expect(names).toContain('vault.json');
  expect(names.filter((n) => n.endsWith('.enc'))).toHaveLength(1);
  const everything = files.map((f) => f.name + f.text).join('\n');
  expect(everything).not.toContain('FOLDER_SYNC_KEY');
  expect(everything).not.toContain('folder-sync-secret-value');

  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await expect(page.locator('.sync-card', { hasText: 'sync 폴더에 동기화합니다.' })).toBeVisible();
});
