// 디자인 검토용 화면 캡처. 개발 서버(5173)가 떠 있어야 한다.
//   node scripts/shots.mjs <출력 폴더> [light|dark]
// 예시 메모를 넣고 주요 화면을 PC(1440×900)와 모바일(390×844)로 찍는다. 테스트가 아니라 눈으로 보기 위한 도구.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
const scheme = process.argv[3] === 'dark' ? 'dark' : 'light';
mkdirSync(out, { recursive: true });
const PASSWORD = 'shots 보라색 자전거 달력 소나무'; // 캡처 전용 값

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function seed(page) {
  await page.goto('http://localhost:5173/');
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  await page.getByRole('button', { name: '열쇠 만들기' }).click();
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  const quick = page.getByLabel('빠른 메모');
  for (const t of ['읽을 책 목록', '사이드 프로젝트 아이디어', '장보기: 우유, 달걀, 커피', '운동 기록']) {
    await quick.fill(t);
    await quick.press('Enter');
  }
  // 본문이 있는 메모 하나
  await page.locator('.list-title-row').getByRole('button', { name: '새 메모' }).click();
  await page.getByLabel('메모 제목').fill('주간 회의');
  await page.locator('.cm-content').click();
  await page.keyboard.type('## 이번 주\n\n- [x] 디자인 검토\n배포 일정 확정\n회고 문서 쓰기\n\n다음 주까지 #업무 정리. 관련 메모는 [[사이드 프로젝트 아이디어]]\n\n> 결정은 짧게, 기록은 남기기\n\n## 할 일\n- [ ] @민수 발표 자료 보내기');
  await page.waitForTimeout(1500);
  // 일정
  await page.locator('.sidebar').getByRole('button', { name: '모든 메모' }).click();
  await page.getByRole('button', { name: '캘린더', exact: true }).click();
  for (const [offset, text] of [[0, '보고서 마감'], [2, '치과 예약 3시'], [2, '엄마 생일 선물'], [5, '기말 발표 준비'], [9, '이사 견적'], [-3, '독서 모임']]) {
    const cell = page.locator(`[data-day="${day(offset)}"]`);
    await page.locator('.cal-nav').getByRole('button', { name: '오늘' }).click(); // 다른 달 칸을 누르면 달이 넘어가므로 매번 돌아온다
    if ((await cell.count()) === 0) continue;
    await cell.click();
    await quick.fill(text);
    await quick.press('Enter');
  }
  await page.locator('.cal-nav').getByRole('button', { name: '오늘' }).click();
  await page.locator('[aria-label="메모 닫기"]').click({ timeout: 2000 }).catch(() => undefined);
}

const shot = (page, name) => page.screenshot({ path: join(out, `${scheme}-${name}.png`) });

const browser = await chromium.launch({ channel: 'chrome' });
// ---- PC ----
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/');
  await shot(page, 'pc-1-setup');
  await seed(page);
  await page.locator('.sidebar').getByRole('button', { name: '살펴볼 것' }).first().click();
  await shot(page, 'pc-0-today');
  await page.locator('.note-row', { hasText: '주간 회의' }).click();
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name: '서버가 보는 모습' }).click();
  await shot(page, 'pc-0-proof');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '모든 메모' }).first().click();
  await page.getByRole('button', { name: '캘린더', exact: true }).click();
  await page.locator(`[data-day="${day(2)}"]`).click();
  await shot(page, 'pc-4-calendar');
  await page.locator('.agenda-day .note-row').first().click();
  await shot(page, 'pc-5-calendar-open');
  await page.locator('[aria-label="메모 닫기"]').click();
  await page.getByRole('button', { name: '카드', exact: true }).click();
  await shot(page, 'pc-6-cards');
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await shot(page, 'pc-2-list-empty-editor');
  await page.locator('.note-row', { hasText: '주간 회의' }).click();
  await shot(page, 'pc-3-list-editor');
  await page.locator('.sidebar').getByRole('button', { name: '검색과 명령' }).click();
  await page.getByPlaceholder('메모 검색 또는 명령…').fill('회의');
  await shot(page, 'pc-7-palette');
  await page.keyboard.press('Escape');
  await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
  await shot(page, 'pc-8-settings');
  await page.getByRole('button', { name: '메모로 돌아가기' }).click();
  await page.getByRole('button', { name: '잠금', exact: true }).click();
  await shot(page, 'pc-9-unlock');
  await ctx.close();
}
// ---- 모바일 ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: 'ko-KR', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/');
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#pw2').fill(PASSWORD);
  await shot(page, 'm-1-setup');
  await page.getByRole('button', { name: '열쇠 만들기' }).click();
  await page.getByRole('button', { name: '적어두었습니다' }).click();
  const quick = page.getByLabel('빠른 메모');
  for (const t of ['읽을 책 목록', '장보기: 우유, 달걀', '주간 회의 준비 #업무']) {
    await quick.fill(t);
    await quick.press('Enter');
  }
  await quick.fill('내일 치과 3시');
  await shot(page, 'm-0-quick-date');
  await quick.press('Enter');
  await page.waitForTimeout(400);
  await shot(page, 'm-0-today');
  await page.getByRole('button', { name: '모든 메모' }).first().click();
  await shot(page, 'm-2-list');
  await page.getByRole('button', { name: '캘린더', exact: true }).click();
  await page.locator(`[data-day="${day(0)}"]`).click();
  await quick.fill('보고서 마감');
  await quick.press('Enter');
  await page.waitForTimeout(400);
  await shot(page, 'm-3-calendar');
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await page.locator('.note-row').first().click();
  await shot(page, 'm-4-editor');
  await ctx.close();
}
await browser.close();
console.log('saved to', out);
