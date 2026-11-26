import { expect, test, type Page } from '@playwright/test';
import { importEnv, setup } from './helpers';

/**
 * 연결 탭 (docs/STRATEGY.md 계획 15). 폴더 고르기 창은 사람이 눌러야 해서, 브라우저 전용 저장소(OPFS)의 폴더를 대신 돌려준다.
 * 그 폴더에 미리 `.git/HEAD`와 AI 사용 기록을 넣어 두고, 앱이 쓴 파일을 테스트가 직접 읽어 본다.
 */
const FILE_PASS = 'e2e file passphrase 4821';
const AI_LOG = [
  JSON.stringify({ at: '2026-11-20T10:00:00Z', tool: 'list_keys' }),
  '{ this line is broken',
  JSON.stringify({ at: '2026-11-21T10:00:00Z', tool: 'run_with_keys', command: 'npm test -- webhook', keys: ['STRIPE_SECRET_KEY'], redacted: 1 }),
  JSON.stringify({ at: '2026-11-22T10:00:00Z', tool: 'request_key', keys: ['RESEND_API_KEY'], env: 'dev' }),
  JSON.stringify({ at: 'not a date', tool: 'list_keys' }),
  JSON.stringify({ at: '2026-11-19T10:00:00Z', tool: 'run_with_keys', command: 'npm run old-1' }),
  JSON.stringify({ at: '2026-11-18T10:00:00Z', tool: 'run_with_keys', command: 'npm run old-2' }),
  JSON.stringify({ at: '2026-11-17T10:00:00Z', tool: 'run_with_keys', command: 'npm run oldest' }),
].join('\n');

/** OPFS 폴더의 파일 이름과 내용 */
const readFolder = (page: Page) =>
  page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop-code');
    const out: Record<string, string> = {};
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind !== 'file' || name.endsWith('.crswap')) continue; // 쓰는 도중의 임시 파일
      try {
        out[name] = await (await (h as FileSystemFileHandle).getFile()).text();
      } catch {
        /* 앱이 그 파일을 바꿔 쓰는 중이면 다음 확인에서 읽는다 */
      }
    }
    return out;
  });

test('연결 탭: 코드 폴더에 암호화된 키 파일과 .vault.yml을 쓰고, 필요한 키·AI 스위치·AI 기록을 보여 준다', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('shop-code', { create: true });
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  await page.evaluate(async (log) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop-code', { create: true });
    const put = async (dir: FileSystemDirectoryHandle, name: string, text: string) => {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    };
    await put(await root.getDirectoryHandle('.git', { create: true }), 'HEAD', 'ref: refs/heads/feature/pay\n');
    await put(await root.getDirectoryHandle('.vault', { create: true }), 'ai-log.jsonl', log);
  }, AI_LOG);

  await importEnv(page, 'shop', ['STRIPE_SECRET_KEY=sk-dev-value-0001', 'SESSION_SECRET=dev-session-value-0001', 'DATABASE_URL=postgres://dev'], 'dev');
  await importEnv(page, 'shop', ['STRIPE_SECRET_KEY=sk-prod-value-0001', 'DATABASE_URL=postgres://prod'], 'prod');

  await page.getByRole('tab', { name: '연결' }).click();
  await expect(page.getByRole('tab', { name: '연결' })).toHaveAttribute('aria-selected', 'true');
  const folder = page.getByRole('region', { name: '코드 폴더' });
  await folder.getByRole('button', { name: '폴더 고르기' }).click();
  await expect(folder).toContainText('shop-code');
  await expect(folder).toContainText('feature/pay');
  await expect(folder).toContainText('아직 쓰지 않음');

  // git 저장소인데 .gitignore가 키 파일을 막지 않으면 경고한다
  await expect(folder.getByRole('button', { name: '.gitignore에 추가' })).toBeVisible();

  // 약한 파일 비밀번호는 받지 않는다 (키 파일이 새면 이것만 남은 방어)
  await folder.getByRole('button', { name: '파일 비밀번호 정하기' }).click();
  await page.getByRole('alertdialog').getByLabel('파일 비밀번호').fill('abc123');
  await page.getByRole('alertdialog').getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/비밀번호가 약합니다/)).toBeVisible();
  expect(Object.keys(await readFolder(page))).toEqual([]);

  // 파일 비밀번호를 정하면 환경마다 .env.<환경>.age를 쓴다
  await folder.getByRole('button', { name: '파일 비밀번호 정하기' }).click();
  await page.getByRole('alertdialog').getByLabel('파일 비밀번호').fill(FILE_PASS);
  await page.getByRole('alertdialog').getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('키 파일 2개를 썼습니다.')).toBeVisible();
  let files = await readFolder(page);
  expect(Object.keys(files).sort()).toEqual(['.env.dev.age', '.env.prod.age']); // 평문 .env는 없다
  for (const name of ['.env.dev.age', '.env.prod.age']) {
    expect(files[name]!.startsWith('age-encryption.org/v1')).toBe(true);
    expect(files[name]).not.toContain('STRIPE_SECRET_KEY');
    expect(files[name]).not.toContain('sk-dev-value');
  }
  await expect(folder).toContainText('.env.dev.age, .env.prod.age');
  // 파일 비밀번호는 평문으로 남지 않는다
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain(FILE_PASS);

  // .vault.yml 만들기: 정해진 모양 그대로, 브랜치는 있는 환경만, required는 이 프로젝트의 이름들
  await page.getByRole('region', { name: '.vault.yml' }).getByRole('button', { name: '.vault.yml 만들기' }).click();
  await expect(page.getByText('.vault.yml을 만들었습니다.')).toBeVisible();
  files = await readFolder(page);
  expect(files['.vault.yml']).toBe('project: shop\nai: true\nbranches:\n  main: prod\n  "*": dev\nrequired:\n  - DATABASE_URL\n  - SESSION_SECRET\n  - STRIPE_SECRET_KEY\n');
  await expect(folder).toContainText('feature/pay → dev');

  // .gitignore에 추가: 키 파일과 AI 기록을 막는 줄이 생기고 경고가 사라진다
  await folder.getByRole('button', { name: '.gitignore에 추가' }).click();
  await expect(page.getByText('.gitignore에 추가했습니다.')).toBeVisible();
  files = await readFolder(page);
  expect(files['.gitignore']).toContain('.env*.age');
  expect(files['.gitignore']).toContain('.vault/');
  await expect(folder.getByRole('button', { name: '.gitignore에 추가' })).toHaveCount(0);

  // 필요한 키: dev 기준 3 / 3, prod에는 SESSION_SECRET이 없다 → 넣기 = 그 이름·환경으로 키를 만들어 연다
  const required = page.getByRole('region', { name: '필요한 키' });
  await expect(required.locator('.connect-count')).toContainText('3 / 3');
  await expect(required.locator('.connect-count')).toContainText('dev 환경 기준');
  await expect(required.locator('.connect-row')).toHaveCount(1);
  await expect(required.locator('.connect-row')).toContainText('prod에 없음');
  const before = files['.env.prod.age'];
  await required.getByRole('button', { name: 'prod에 SESSION_SECRET 넣기' }).click();
  await expect(page.getByRole('tab', { name: '키 6' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.editor-title')).toHaveValue('SESSION_SECRET');
  await expect(page.locator('#secret-env')).toHaveValue('prod');
  // 값을 넣으면 잠시 뒤 그 폴더의 키 파일을 다시 쓴다
  await page.getByLabel('값', { exact: true }).fill('prod-session-value-0001');
  await page.getByLabel('값', { exact: true }).press('Tab');
  await expect.poll(async () => {
    const now = (await readFolder(page))['.env.prod.age'];
    return !!now && now !== before;
  }, { timeout: 20_000 }).toBe(true);

  // AI 스위치는 .vault.yml의 ai 줄만 바꾼다
  await page.getByRole('tab', { name: '연결' }).click();
  await expect(page.getByRole('region', { name: '필요한 키' })).toContainText('필요한 키가 다 있습니다.');
  const ai = page.getByRole('region', { name: 'AI 도구 (MCP)' });
  const toggle = ai.getByRole('switch', { name: /이 프로젝트의 키를 AI 도구가 쓸 수 있음/ });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect((await readFolder(page))['.vault.yml']).toBe('project: shop\nai: false\nbranches:\n  main: prod\n  "*": dev\nrequired:\n  - DATABASE_URL\n  - SESSION_SECRET\n  - STRIPE_SECRET_KEY\n');

  // MCP 명령: 진짜 비밀번호 대신 자리 표시. 복사도 그대로
  const command = 'claude mcp add --transport stdio --env VAULT_ENV_PASSPHRASE=<파일 비밀번호> keys-kept -- npx -y keys-kept mcp';
  await expect(ai).toContainText(command);
  await expect(ai).toContainText('/plugin marketplace add jwn7/vault-notes');
  await expect(ai).toContainText('/plugin install keys-kept@vault-notes');
  await expect(ai).toContainText('AI가 받지 않는 것');
  await ai.getByRole('button', { name: '명령 복사' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  await expect(page.locator('body')).not.toContainText(FILE_PASS);

  // 최근에 AI가 쓴 키: 최근 것부터 5개, 깨진 줄은 건너뛴다
  const log = page.getByRole('region', { name: '최근에 AI가 쓴 키' });
  const rows = log.locator('.log-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('키를 요청함');
  await expect(rows.nth(0)).toContainText('RESEND_API_KEY');
  await expect(rows.nth(0)).toContainText('아직 안 넣음');
  await expect(rows.nth(1)).toContainText('npm test -- webhook');
  await expect(rows.nth(1)).toContainText('출력에서 1번 가림');
  await expect(log).not.toContainText('npm run oldest');
});
