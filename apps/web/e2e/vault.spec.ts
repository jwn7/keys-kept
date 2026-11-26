import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importEnv, newProject, setup, unlock } from './helpers';

// 키 모양은 조각을 이어 붙여 만든다(비밀 검사기가 막지 않게). 실제 키가 아니다.
const OPENAI = ['sk-', 'proj-', 'a'.repeat(48)].join('');
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SERVICE_ROLE = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role: 'service_role' })}.${'s'.repeat(43)}`;

test('처음 설정 → 복구 키 12단어 → 빈 금고는 .env를 넣으라고 한다', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.sidebar .badge')).toHaveText('로컬 전용');
  await expect(page.getByRole('heading', { name: '쓰던 .env 파일을 여기로 끌어다 놓으세요' })).toBeVisible();
  await expect(page.locator('.sidebar')).toContainText('아직 없음');
  // 메모 앱 기능은 없다
  for (const gone of ['새 메모', '모든 메모', '일정', '캘린더', '오늘의 메모']) await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
});

test('약한 비밀번호로는 열쇠를 만들 수 없다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pw').fill('password1234');
  await page.locator('#pw2').fill('password1234');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: '열쇠 만들기' })).toBeDisabled();
});

test('첫 화면: 프로젝트 하나면 바로 열고, 여럿이면 카드 목록과 경고 띠, 마지막에 연 프로젝트가 맨 앞', async ({ page }) => {
  await setup(page);
  await importEnv(page, 'shop', [`OPENAI_API_KEY=${OPENAI}`, `NEXT_PUBLIC_SUPABASE_KEY=${SERVICE_ROLE}`], 'prod');
  await importEnv(page, 'shop', ['OPENAI_API_KEY=dev-openai-value'], 'dev');

  // 프로젝트가 하나뿐: 잠갔다 열면 그 프로젝트가 바로 열린다
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await unlock(page);
  await expect(page.getByRole('heading', { name: 'shop', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '키 3' })).toHaveAttribute('aria-selected', 'true');

  await importEnv(page, 'blog', ['DATABASE_URL=postgres://u:p@host/db']);
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await unlock(page);
  // 여럿: 프로젝트 목록. 마지막에 연 blog가 맨 앞, 카드마다 환경·키 수·경고 수
  await expect(page.getByRole('heading', { name: '프로젝트', exact: true })).toBeVisible();
  const cards = page.locator('.project-card:not(.project-new)');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('blog');
  await expect(cards.nth(0)).toContainText('환경 구분 없음');
  const shop = page.getByRole('button', { name: 'shop 열기' });
  await expect(shop).toContainText('dev');
  await expect(shop).toContainText('prod');
  await expect(shop).toContainText('키 3개');
  await expect(shop).toContainText('살펴볼 것 1');

  // 경고 띠 → 살펴볼 것
  const strip = page.locator('.attention-strip');
  await expect(strip).toContainText('살펴볼 키 1개');
  await expect(strip).toContainText('공개되는 이름 1');
  await strip.getByRole('button', { name: '보기' }).click();
  await expect(page.getByRole('heading', { name: '살펴볼 것', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '공개될 수 있는 키' }).locator('.key-row')).toContainText('NEXT_PUBLIC_SUPABASE_KEY');

  // 사이드바: 모든 프로젝트 → 카드를 누르면 그 프로젝트
  await page.locator('.sidebar').getByRole('button', { name: '모든 프로젝트' }).click();
  await shop.click();
  await expect(page.getByRole('heading', { name: 'shop', exact: true })).toBeVisible();
  await expect(page.locator('.key-row')).toHaveCount(3);
  // 마지막에 연 프로젝트는 잠금 키로 잠가 둔다(평문으로 남기지 않는다)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain('shop');
});

test('경고가 없으면 띠도 없다', async ({ page }) => {
  await setup(page);
  await importEnv(page, 'a', ['A_KEY=value-a']);
  await importEnv(page, 'b', ['B_KEY=value-b']);
  await page.locator('.sidebar').getByRole('button', { name: '모든 프로젝트' }).click();
  await expect(page.locator('.project-card:not(.project-new)')).toHaveCount(2);
  await expect(page.locator('.attention-strip')).toHaveCount(0);
});

test('쓰자마자 잠가도 내용이 남는다 (잠그기 전 저장)', async ({ page }) => {
  await setup(page);
  await newProject(page, 'shop');
  await page.locator('.list-title-row').getByRole('button', { name: '새 키' }).click();
  await page.getByLabel('이름', { exact: true }).fill('STRIPE_SECRET_KEY');
  await page.locator('.cm-content').click();
  await page.keyboard.type('결제 서버에서만 씀');
  await page.getByRole('button', { name: '잠금', exact: true }).click(); // 1초 디바운스 전에 잠근다
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();

  await unlock(page);
  await page.locator('.key-row', { hasText: 'STRIPE_SECRET_KEY' }).locator('.key-main').click();
  await expect(page.locator('.cm-content')).toContainText('결제 서버에서만 씀');
});

test('틀린 비밀번호는 거절하고 안내한다', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await unlock(page, '틀린 비밀번호');
  await expect(page.getByText('비밀번호가 틀렸습니다')).toBeVisible();
  await expect(page.getByRole('heading', { name: '잠금 해제' })).toBeVisible();
});

test('빠른 추가는 키만 받는다: NAME=value, 키 값, 이름만. 그 밖의 글은 안내만 하고 만들지 않는다', async ({ page }) => {
  await setup(page);
  await newProject(page, 'shop');
  const quick = page.getByLabel('빠른 추가');
  await quick.fill('내일 치과 3시');
  await quick.press('Enter');
  await expect(page.getByText('NAME=value 꼴이나 알아볼 수 있는 키 값만 넣을 수 있습니다.', { exact: false })).toBeVisible();
  await expect(page.locator('.key-row')).toHaveCount(0);

  for (const t of ['API_URL=https://example.com', OPENAI]) {
    await quick.fill(t);
    await quick.press('Enter');
  }
  await expect(page.locator('.key-row')).toHaveCount(2);
  await expect(page.locator('.key-row', { hasText: 'OPENAI_API_KEY' })).toContainText('OpenAI'); // 값만 넣어도 이름을 붙인다
  await quick.fill('SESSION_SECRET');
  await quick.press('Enter');
  await expect(page.locator('.editor-title')).toHaveValue('SESSION_SECRET'); // 이름만이면 값을 넣으라고 연다

  await page.locator('.sidebar').getByRole('button', { name: '찾아서 복사' }).click();
  await page.getByPlaceholder('키 이름으로 찾기 또는 명령…').fill('api url');
  const items = page.locator('.palette-item', { hasText: 'API_URL' });
  await expect(items).toHaveCount(1);
});

test('서버가 보는 모습에는 평문이 없고, 사용 수치는 이 기기에만 남는다', async ({ page }) => {
  await setup(page);
  await newProject(page, 'diary');
  await page.getByLabel('빠른 추가').fill('DIARY_TOKEN=nobody-can-read-this-value');
  await page.getByLabel('빠른 추가').press('Enter');
  await page.locator('.key-row', { hasText: 'DIARY_TOKEN' }).locator('.key-main').click();
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '서버가 보는 모습' }).click();
  const raw = page.locator('.proof-raw');
  await expect(raw).toContainText('"ciphertext"');
  await expect(raw).not.toContainText('DIARY');
  await expect(raw).not.toContainText('nobody-can-read');
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click();

  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  const usage = page.locator('#usage');
  await expect(usage.locator('.row', { hasText: '최근 7일 중 연 날' })).toContainText('1일');
  await expect(usage.locator('.row', { hasText: '처음 설정하고 첫 메모까지' })).toContainText('초');
  await expect(usage.locator('.row', { hasText: '빠른 메모로 적은 비율' })).toContainText('100%');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain('DIARY'); // 개수와 시각만
  expect(stored).not.toContain('diary'); // 프로젝트 이름도 평문으로 남지 않는다
});

test('휴지통으로 보낸 뒤 되돌리기, 휴지통에서 복원하면 그 프로젝트로 돌아간다', async ({ page }) => {
  await setup(page);
  await newProject(page, 'shop');
  await page.getByLabel('빠른 추가').fill('OLD_KEY=old-value-123');
  await page.getByLabel('빠른 추가').press('Enter');
  await page.locator('.key-row', { hasText: 'OLD_KEY' }).locator('.key-main').click();
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '휴지통으로' }).click();
  await expect(page.locator('.key-row')).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('.key-row', { hasText: 'OLD_KEY' })).toBeVisible();

  await page.locator('.key-row', { hasText: 'OLD_KEY' }).locator('.key-main').click();
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '휴지통으로' }).click();
  await page.locator('.sidebar').getByRole('button', { name: '휴지통' }).click();
  await page.locator('.key-row', { hasText: 'OLD_KEY' }).locator('.key-main').click();
  await page.getByRole('button', { name: '복원' }).click();
  await expect(page.getByRole('heading', { name: 'shop', exact: true })).toBeVisible();
  await expect(page.locator('.key-row', { hasText: 'OLD_KEY' })).toBeVisible();
});

test('예전 메모(키가 아닌 항목)는 "프로젝트 없음"에 그대로 있고, 열어서 고치고 키로 바꿀 수 있다', async ({ page }) => {
  await setup(page);
  // 예전 메모를 마크다운 폴더 가져오기로 넣는다 (메모를 새로 만드는 단추는 없다)
  const dir = mkdtempSync(join(tmpdir(), 'vault-e2e-md-'));
  writeFileSync(join(dir, '서버 메모.md'), '스테이징 서버 접속 방법');
  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.row', { hasText: '마크다운 폴더 가져오기' }).getByRole('button', { name: '가져오기' }).click()]);
  await chooser.setFiles(dir);
  await expect(page.getByText('가져왔습니다. 추가 1개')).toBeVisible();
  await page.getByRole('button', { name: '프로젝트로 돌아가기' }).click();

  await page.getByRole('button', { name: '프로젝트 없음 열기' }).click();
  await expect(page.getByRole('heading', { name: '프로젝트 없음', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '연결' })).toHaveCount(0); // 이름 없는 묶음은 코드 폴더에 잇지 않는다
  const row = page.locator('.note-row', { hasText: '서버 메모' });
  await expect(row).toContainText('스테이징 서버 접속 방법');
  await row.click();
  await expect(page.locator('.cm-content')).toContainText('스테이징 서버 접속 방법');
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '키 항목으로 바꾸기' }).click();
  await expect(page.getByLabel('값', { exact: true })).toBeVisible();
  await page.getByLabel('값', { exact: true }).fill('ssh-staging-secret');
  await page.getByLabel('값', { exact: true }).press('Tab');
  await expect(page.locator('.key-row', { hasText: '서버 메모' })).toBeVisible();
});
