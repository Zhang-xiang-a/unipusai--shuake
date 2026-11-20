import {chromium} from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9228');
const pages = browser.contexts().flatMap((context) => context.pages());
console.log('total pages:', pages.length);

for (const page of pages) {
  const url = page.url();
  let title = '';
  let hasLoginForm = false;
  try { title = await page.title(); } catch {}
  try {
    hasLoginForm = await page.locator('input[type=password]').count() > 0;
  } catch {}
  console.log(`- ${url.slice(0, 140)}`);
  console.log(`    title="${title.slice(0, 50)}" loginForm=${hasLoginForm}`);
}

await browser.close().catch(() => {});