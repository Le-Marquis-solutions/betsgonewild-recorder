// Screen-recording factory — Bets Gone Wild
// Usage: node record.mjs requests/<file>.json   ({ "url": "...", "slug": "..." })
// Records a slow, human-like read-only navigation with Playwright's recordVideo,
// then writes recordings/<slug>.webm + recordings/<slug>.png (full-page poster).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const reqPath = process.argv[2];
if (!reqPath) {
  console.error('usage: node record.mjs requests/<file>.json');
  process.exit(1);
}
const { url, slug } = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
if (!url || !slug) {
  console.error('request JSON must contain "url" and "slug"');
  process.exit(1);
}

fs.mkdirSync('recordings', { recursive: true });
const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
const pause = (page, ms) => page.waitForTimeout(ms);
const rand = (a, b) => Math.round(a + Math.random() * (b - a));

async function safe(fn, label) {
  try {
    await fn();
  } catch (e) {
    console.log(`[skip] ${label}: ${String(e.message).split('\n')[0]}`);
  }
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1280, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

// 1) Load the page, let it settle, dismiss any sign-in dialog (Escape only).
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await safe(() => page.waitForLoadState('networkidle', { timeout: 30000 }), 'networkidle');
await pause(page, 3000);
await safe(() => page.keyboard.press('Escape'), 'dismiss dialog');
await pause(page, 1200);

// Helper: slow human-like scrolling, small wheel steps with pauses.
async function scrollDownBy(totalPx) {
  let done = 0;
  let lastY = await page.evaluate(() => window.scrollY);
  while (done < totalPx) {
    await page.mouse.wheel(0, 250);
    done += 250;
    await pause(page, rand(1500, 2500));
    const y = await page.evaluate(() => window.scrollY);
    if (y === lastY && done > 500) break; // bottom reached
    lastY = y;
  }
}

// 2) Scroll down slowly until the price chart is in view.
await scrollDownBy(500);
await pause(page, 2000);

// 3) Hover across the chart, left to right, pausing for tooltips.
await safe(async () => {
  const chart = page
    .locator('.recharts-wrapper svg, svg[class*="chart"], canvas')
    .first();
  const box = await chart.boundingBox({ timeout: 8000 });
  if (box) {
    for (const fx of [0.12, 0.32, 0.52, 0.72, 0.92]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.45, {
        steps: 15,
      });
      await pause(page, 2000);
    }
  }
}, 'chart hover');

// 4) Time-range clicks: 1W, 1M, ALL.
for (const label of ['1W', '1M', 'ALL']) {
  await safe(async () => {
    await page.getByText(label, { exact: true }).first().click({ timeout: 6000 });
    await pause(page, 2200);
  }, `range ${label}`);
}

// 5) Expand the Order Book section.
await safe(async () => {
  await page.getByText(/order book/i).first().click({ timeout: 6000 });
  await pause(page, 2200);
}, 'order book');

// 6) Open the Activity tab.
await safe(async () => {
  await page.getByRole('tab', { name: /activity/i }).first().click({ timeout: 6000 });
  await pause(page, 2000);
}, 'activity tab (role)');
await safe(async () => {
  const t = page.getByText('Activity', { exact: true }).first();
  if (await t.isVisible().catch(() => false)) {
    await t.click({ timeout: 4000 });
    await pause(page, 1500);
  }
}, 'activity tab (text)');

// 7) Slow scroll through the activity feed.
await scrollDownBy(2600);
await pause(page, 1800);

// 8) Back to the top.
await safe(
  () => page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })),
  'scroll to top'
);
await pause(page, 2600);

// 9) Full-page poster screenshot for QC.
await safe(
  () => page.screenshot({ path: path.join('recordings', `${slug}.png`), fullPage: true }),
  'poster screenshot'
);

await context.close(); // finalizes the video file
await browser.close();

// 10) Move the recorded video to its final name.
const webms = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
if (!webms.length) {
  console.error('no video produced');
  process.exit(2);
}
fs.renameSync(path.join(videoDir, webms[0]), path.join('recordings', `${slug}.webm`));
fs.rmSync(videoDir, { recursive: true, force: true });
console.log(`done: recordings/${slug}.webm + recordings/${slug}.png`);
