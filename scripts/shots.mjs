// Renders photo-mode shots of the game in headless Chromium (software GPU) and saves PNGs.
// Usage: npm run shots [-- name1 name2 ...]   (expects `npm run preview` on :4173, or starts it)
// Env: SHOTS_URL (another server, e.g. a second build), SHOTS_OUT (output folder, default shots/out).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const ALL = ['title', 'play', 'vista', 'sun', 'planet', 'ship'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const base = process.env.SHOTS_URL ?? 'http://localhost:4173';
const outDir = process.env.SHOTS_OUT ?? 'shots/out';
mkdirSync(outDir, { recursive: true });

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

let server;
if (!(await up(base))) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up(base)); i++) await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.text().startsWith('[shot]') || m.text().startsWith('[world]')) console.log(m.text());
  else if (m.type() === 'error') errors.push(m.text());
});

for (const name of names) {
  const t0 = Date.now();
  const [shotName, extra] = name.split('&', 2);
  // Don't wait for "load": the first heavy frame renders before it fires. __shotReady is what counts.
  await page.goto(`${base}/?shot=${shotName}${extra ? '&' + name.slice(shotName.length + 1) : ''}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300_000 });
  await page.screenshot({ path: `${outDir}/${name.replace(/[&=]/g, '_')}.png`, timeout: 180_000 });
  console.log(`${name}: ${Date.now() - t0} ms`);
}
await browser.close();
server?.kill();
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
