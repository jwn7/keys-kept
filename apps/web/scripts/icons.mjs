// public/icon.svg → icon-192.png, icon-512.png. 개발 서버(5173)가 떠 있어야 한다(앱에 든 글꼴로 그리려고).
//   node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = readFileSync(join(pub, 'icon.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5173/');
  await page.evaluate(
    async ({ svg, size }) => {
      document.body.innerHTML = `<div id="icon" style="width:${size}px;height:${size}px;position:fixed;inset:0;z-index:9999">${svg}</div>`;
      document.querySelector('#icon svg').setAttribute('style', 'width:100%;height:100%;display:block');
      await document.fonts.load("600 27px 'Hahmlet'", '봉');
      await document.fonts.ready;
    },
    { svg, size },
  );
  await page.locator('#icon').screenshot({ path: join(pub, `icon-${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
