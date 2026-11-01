// Capture Phaser renders through the real export button, using the installed Microsoft Edge (headless).
//   npx tsx scripts/shots.ts <outDir> <seed|a..b> ...      (needs `npx vite` running on :5173)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, ...args] = process.argv.slice(2);
const seeds: string[] = [];
for (const a of args) { const m = a.match(/^(\d+)\.\.(\d+)$/); if (m) for (let i = +m[1]; i <= +m[2]; i++) seeds.push(String(i)); else seeds.push(a); }
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
page.on('console', m => { if (m.type() === 'error') console.log('[page error]', m.text()); });
page.on('pageerror', e => console.log('[page exception]', e.message));
for (const [i, s] of seeds.entries()) {
  await page.goto(`http://localhost:5173/?seed=${encodeURIComponent(s)}`);
  await page.waitForFunction((seed) => document.getElementById('info')?.textContent?.includes(`seed ${seed} `), s, { timeout: 60000 });
  await page.waitForTimeout(300);
  if (i === 0) await page.screenshot({ path: join(outDir, `ui_seed${s}.png`) });
  const downloads: Promise<void>[] = [];
  const got = new Promise<void>((resolve) => {
    let n = 0;
    page.on('download', d => { downloads.push(d.saveAs(join(outDir, d.suggestedFilename()))); if (++n === 3) resolve(); });
  });
  await page.click('#export');
  await got; await Promise.all(downloads);
  page.removeAllListeners('download');
  console.log(`seed ${s}: exported`);
}
await browser.close();
