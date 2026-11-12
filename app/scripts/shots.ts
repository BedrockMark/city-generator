// Capture Phaser renders through the real export button, using the installed Microsoft Edge (headless).
//   npx tsx scripts/shots.ts <outDir> [--anno] [--q=nov=0.3] <seed|a..b> ...      (needs `npx vite` running on :5173, or PORT=)
//   npx tsx scripts/shots.ts <outDir> <worldSeed> --city x,y,z [--city x,y,z ...]  city mode: views of one world seed
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

//   --anno: also screenshot the annotation mode and export with the annotation layers on
const argv = process.argv.slice(2);
//   --city x,y,z: city mode view (world cell x, y at the centre, zoom z); repeatable; replaces the single-block shots
const cities: string[] = [];
for (let i = argv.indexOf('--city'); i >= 0; i = argv.indexOf('--city')) {
  if (!/^-?[\d.]+,-?[\d.]+,[\d.]+$/.test(argv[i + 1] ?? '')) throw new Error(`--city needs x,y,z, got ${argv[i + 1]}`);
  cities.push(argv[i + 1]); argv.splice(i, 2);
}
const anno = argv.includes('--anno');
//   --q=...: extra URL parameters for every seed (nov=0.3, p=0 = no pruning ...)
const extra = argv.find(a => a.startsWith('--q='))?.slice(4) ?? '';
const [outDir, ...args] = argv.filter(a => a !== '--anno' && !a.startsWith('--q='));
const seeds: string[] = [];
for (const a of args) { const m = a.match(/^(\d+)\.\.(\d+)$/); if (m) for (let i = +m[1]; i <= +m[2]; i++) seeds.push(String(i)); else seeds.push(a); }
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
page.on('console', m => { if (m.type() === 'error') console.log('[page error]', m.text()); });
page.on('pageerror', e => console.log('[page exception]', e.message));
async function exportAll(click: () => Promise<void>) {
  const downloads: Promise<void>[] = [];
  const got = new Promise<void>((resolve) => {
    let n = 0;
    page.on('download', async d => {
      downloads.push(d.saveAs(join(outDir, d.suggestedFilename())));
      if (++n === await page.evaluate(() => (window as unknown as { __exportCount: number }).__exportCount)) resolve();
    });
  });
  await click();
  await got; await Promise.all(downloads);
  page.removeAllListeners('download');
}
if (cities.length) {
  const s = seeds[0] ?? '1';
  for (const c of cities) {
    const [x, y, z] = c.split(',');
    await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?city=1&seed=${encodeURIComponent(s)}&x=${x}&y=${y}&z=${z}`);
    await page.waitForFunction(() => (window as unknown as { __cityIdle?: boolean }).__cityIdle === true, null, { timeout: 180000, polling: 100 });
    const secs = await page.evaluate(() => (performance.now() - (window as unknown as { __cityT0: number }).__cityT0) / 1000);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `ui_city_${s}_${x}_${y}_${z}.png`) });
    await exportAll(() => page.keyboard.press('e'));
    console.log(`city seed ${s} (${x}, ${y}) z ${z}: view filled in ${secs.toFixed(1)} s, exported`);
  }
  await browser.close();
  process.exit(0);
}
for (const [i, s] of seeds.entries()) {
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?seed=${encodeURIComponent(s)}${extra ? '&' + extra : ''}`);
  await page.waitForFunction((seed) => document.getElementById('info')?.textContent?.includes(`seed ${seed} `), s, { timeout: 180000 });
  await page.waitForTimeout(300);
  if (i === 0) await page.screenshot({ path: join(outDir, `ui_seed${s}.png`) });
  if (i === 0 && anno) { await page.keyboard.press('a'); await page.mouse.move(700, 500); await page.waitForTimeout(400); await page.screenshot({ path: join(outDir, `ui_anno_seed${s}.png`) }); await page.keyboard.press('a'); }
  if (anno) { await page.keyboard.press('a'); await page.waitForTimeout(300); }
  await exportAll(() => page.click('#export'));
  console.log(`seed ${s}: exported`);
}
await browser.close();
