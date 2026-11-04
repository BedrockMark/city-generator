// Capture Phaser renders through the real export button, using the installed Microsoft Edge (headless).
//   npx tsx scripts/shots.ts <outDir> [--anno] [--heat] [--q=e=exp-02:1&nov=0.3] <seed|a..b> ...      (needs `npx vite` running on :5173)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

//   --anno: also screenshot the annotation mode and export with the annotation layers on
const argv = process.argv.slice(2);
const anno = argv.includes('--anno');
//   --heat: turn the judge heat map on (H): screenshot it and export _heat.png too
const heat = argv.includes('--heat');
//   --q=...: extra URL parameters for every seed (e=exp-02:1 = 整体修图, p=0 = no pruning ...)
const extra = argv.find(a => a.startsWith('--q='))?.slice(4) ?? '';
const [outDir, ...args] = argv.filter(a => a !== '--anno' && a !== '--heat' && !a.startsWith('--q='));
const seeds: string[] = [];
for (const a of args) { const m = a.match(/^(\d+)\.\.(\d+)$/); if (m) for (let i = +m[1]; i <= +m[2]; i++) seeds.push(String(i)); else seeds.push(a); }
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
page.on('console', m => { if (m.type() === 'error') console.log('[page error]', m.text()); });
page.on('pageerror', e => console.log('[page exception]', e.message));
for (const [i, s] of seeds.entries()) {
  await page.goto(`http://localhost:5173/?seed=${encodeURIComponent(s)}${extra ? '&' + extra : ''}`);
  await page.waitForFunction((seed) => document.getElementById('info')?.textContent?.includes(`seed ${seed} `), s, { timeout: 180000 });
  await page.waitForTimeout(300);
  if (i === 0) await page.screenshot({ path: join(outDir, `ui_seed${s}.png`) });
  if (i === 0 && anno) { await page.keyboard.press('a'); await page.mouse.move(700, 500); await page.waitForTimeout(400); await page.screenshot({ path: join(outDir, `ui_anno_seed${s}.png`) }); await page.keyboard.press('a'); }
  if (heat) { await page.keyboard.press('h'); await page.mouse.move(700, 500); await page.waitForTimeout(400); if (i === 0) await page.screenshot({ path: join(outDir, `ui_heat_seed${s}.png`) }); }
  const downloads: Promise<void>[] = [];
  const got = new Promise<void>((resolve) => {
    let n = 0;
    page.on('download', async d => {
      downloads.push(d.saveAs(join(outDir, d.suggestedFilename())));
      if (++n === await page.evaluate(() => (window as unknown as { __exportCount: number }).__exportCount)) resolve();
    });
  });
  if (anno) { await page.keyboard.press('a'); await page.waitForTimeout(300); }
  await page.click('#export');
  await got; await Promise.all(downloads);
  page.removeAllListeners('download');
  console.log(`seed ${s}: exported`);
}
await browser.close();
