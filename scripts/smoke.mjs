// Load the built game in a real browser and report whether it actually renders.
//   node scripts/smoke.mjs [chromium|webkit]      (HEADED=1 for a visible window, e.g. real GPU on macOS)
// Prints window.__diag() (frame brightness, failed shaders, WebGL limits) on the title screen
// and in solo play, with full post-processing and with ?post=min. Exits 1 if the frame is black.
import { chromium, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';

const browserName = process.argv[2] ?? 'chromium';
const base = process.env.SMOKE_URL ?? 'http://localhost:4173';

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
  for (let i = 0; i < 80 && !(await up(base)); i++) await new Promise((r) => setTimeout(r, 250));
}

const launcher = browserName === 'webkit' ? webkit : chromium;
const browser = await launcher.launch({ headless: process.env.HEADED !== '1' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 3000)}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let black = false;
for (const extra of ['', '&post=min']) {
  await page.goto(`${base}/?telemetry=0${extra}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof window.__diag === 'function', null, { timeout: 180_000 });
  await page.waitForTimeout(8000);
  const title = await page.evaluate(() => window.__diag());
  console.log(`TITLE ${extra || 'full'} ${JSON.stringify(title)}`);
  await page.getByTestId('solo').click();
  await page.waitForTimeout(8000);
  const play = await page.evaluate(() => window.__diag());
  console.log(`PLAY  ${extra || 'full'} ${JSON.stringify(play)}`);
  await page.screenshot({ path: `smoke-${browserName}${extra ? '-min' : ''}.png` });
  if (!extra && ((title.brightness ?? 0) < 4 || (play.brightness ?? 0) < 4)) black = true;
}
console.log(`\n${logs.length} console errors/warnings:\n${[...new Set(logs)].slice(0, 40).join('\n')}`);
await browser.close();
server?.kill();
if (black) {
  console.log('\nFAIL: the frame is black with full post-processing');
  process.exit(1);
}
