// Render look-dev views of one module in headless Chromium (software GPU) and save PNGs.
//
//   node scripts/lookdev.mjs <page> [view ...]
//
// <page> is the file name in lookdev/ without .html (e.g. "terrain"). With no views listed,
// renders the views named in the page's ?list output, or just the default view.
// Output: shots/lookdev/<page>-<view>.png, plus <page>-sheet.png (all views tiled).

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';

const [page, ...views] = process.argv.slice(2);
if (!page) {
  console.error('usage: node scripts/lookdev.mjs <page> [view ...]');
  process.exit(2);
}
const outDir = 'shots/lookdev';
mkdirSync(outDir, { recursive: true });

const server = await createServer({
  server: { port: 5200 + Math.floor(Math.random() * 700), strictPort: false, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
tab.on('pageerror', (e) => errors.push(e.message));
tab.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});

const files = [];
for (const view of views.length ? views : ['']) {
  const t0 = Date.now();
  const url = `${base}/lookdev/${page}.html${view ? `?view=${view}` : ''}`;
  await tab.goto(url);
  await tab.waitForFunction(() => window.__shotReady === true, null, { timeout: 240_000 });
  const file = `${outDir}/${page}-${view || 'default'}.png`;
  await tab.screenshot({ path: file });
  files.push(file);
  console.log(`${file}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
await browser.close();
await server.close();

if (files.length > 1) {
  // Tile into a 2-column contact sheet of 640x360 cells.
  const cols = 2;
  const rows = Math.ceil(files.length / cols);
  const inputs = files.flatMap((f) => ['-i', f]);
  const scaled = files.map((_, i) => `[${i}]scale=640:360[s${i}]`).join(';');
  const layout = files.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|');
  const sheet = `${outDir}/${page}-sheet.png`;
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', `${scaled};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black`,
    '-frames:v', '1', sheet,
  ]);
  console.log(`${sheet}  (${cols}x${rows})`);
}
if (errors.length) {
  console.log('\nPage errors/warnings:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
}
