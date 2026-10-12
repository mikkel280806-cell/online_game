// Where does the frame time go? Loads the built game in headless Chromium (SwiftShader) in
// photo mode (?shot=<view>&prof=1) and measures the median time per frame with parts of the
// renderer and the world switched off one at a time.
//
//   node scripts/profile.mjs [--views play,title,vista] [--configs a,b,...] [--reps 3]
//                            [--frames 4] [--warm 2] [--scale 1] [--out shots/profile.json]
//                            [--targets before=http://localhost:4418,after=http://localhost:4419]
//                            [--breakdown]   (also print triangles/draws per object, per pass)
//
// Needs `npm run build`; serves dist/ on PROFILE_PORT (default 4173) unless PROFILE_URL or
// --targets is given. With several targets (e.g. two builds) every view is opened once per
// target and the measurements are interleaved, so both see the same machine load.
//
// SwiftShader renders on the CPU, so absolute times mean nothing; ratios between configurations
// show what costs what. Other processes share the CPU: configurations are interleaved and every
// one is measured `reps` times; we report the median of the per-run medians.
//
// The page is 855x492 CSS px at devicePixelRatio 2 (half a MacBook Air's 1710x983 window),
// so `scale` (the renderer's pixel ratio) behaves as on the player's Retina screen.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** name -> profiler spec (see ProfSpec in src/main.ts). Unset fields are the game's defaults. */
export const CONFIGS = {
  baseline: {},
  'ao-off': { ao: false },
  'godrays-off': { rays: false },
  'bloom-off': { bloom: false },
  'grain-off': { grain: false },
  'smaa-off': { smaa: false },
  'post-minimal': { post: 'min' },
  'shadows-off': { shadows: false },
  'csm-1': { cascades: 1 },
  'csm-2': { cascades: 2 },
  'csm-size-1024': { shadowSize: 1024 },
  'terrain-flat-shader': { terrainFlat: true },
  'near-terrain-stride-2': { nearStride: 2 },
  'near-terrain-off': { terrainNear: false },
  'far-terrain-off': { terrainFar: false },
  'rocks-off': { rocks: false },
  'pebbles-off': { pebbles: false },
  'props-off': { props: false },
  'characters-off': { chars: false },
  'sky-off': { sky: false },
  'scale-0.75': { scale: 0.75 },
  'scale-1.0': { scale: 1 },
  'scale-1.25': { scale: 1.25 },
  'scale-1.5': { scale: 1.5 },
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const views = arg('views', 'play,title,vista').split(',');
const configNames = arg('configs', Object.keys(CONFIGS).join(',')).split(',');
const reps = Number(arg('reps', '3'));
const frames = Number(arg('frames', '4'));
const warm = Number(arg('warm', '2'));
const out = arg('out', 'shots/profile.json');
const baseScale = Number(arg('scale', '1'));
for (const n of configNames) if (!CONFIGS[n]) throw new Error(`unknown config ${n}`);

const port = process.env.PROFILE_PORT ?? '4173';
const targets = Object.fromEntries(
  (arg('targets', '') || `game=${process.env.PROFILE_URL ?? `http://localhost:${port}`}`).split(',').map((t) => t.split('=')),
);
const targetNames = Object.keys(targets);

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
let server;
if (!arg('targets', '') && !(await up(targets.game))) {
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 80 && !(await up(targets.game)); i++) await new Promise((r) => setTimeout(r, 250));
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function table(view, res) {
  const lines = [`\n=== ${view} ===`];
  for (const t of targetNames) {
    if (targetNames.length > 1) lines.push(`--- ${t} (${targets[t]})`);
    lines.push('config'.padEnd(24) + 'ms/frame'.padStart(10) + 'x base'.padStart(8) + 'cpu ms'.padStart(9) + 'draws'.padStart(7) + 'tris'.padStart(10) + '  size');
    for (const [name, r] of Object.entries(res[t])) {
      lines.push(
        name.padEnd(24) +
          r.ms.toFixed(1).padStart(10) +
          r.vsBaseline.toFixed(2).padStart(8) +
          r.cpuMs.toFixed(1).padStart(9) +
          String(r.draws).padStart(7) +
          String(r.triangles).padStart(10) +
          `  ${r.size}`,
      );
    }
  }
  return lines.join('\n');
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = {};
mkdirSync(dirname(out), { recursive: true });
for (const view of views) {
  const pages = {};
  for (const t of targetNames) {
    const page = await browser.newPage({ viewport: { width: 855, height: 492 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.error(`[${t} ${view}] ${e.message}`));
    const t0 = Date.now();
    await page.goto(`${targets[t]}/?shot=${view}&prof=1&telemetry=0`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__prof !== undefined, null, { timeout: 300_000 });
    console.log(`${t} ${view}: loaded in ${Date.now() - t0} ms`);
    // Compile everything once at the base scale before timing anything.
    await page.evaluate(async (s) => {
      await window.__prof.set({ scale: s });
      await window.__prof.measure(1, 2);
    }, baseScale);
    pages[t] = page;
    if (process.argv.includes('--breakdown')) {
      const rows = await page.evaluate(async (s) => {
        await window.__prof.set({ scale: s });
        return window.__prof.breakdown();
      }, baseScale);
      const sorted = Object.entries(rows).sort((a, b) => b[1].tris + b[1].shadowTris - (a[1].tris + a[1].shadowTris));
      const tot = sorted.reduce((a, [, r]) => [a[0] + r.tris, a[1] + r.shadowTris, a[2] + r.calls, a[3] + r.shadowCalls], [0, 0, 0, 0]);
      console.log(`\n${t} ${view}: per object (camera tris / shadow tris / camera draws / shadow draws)`);
      console.log(`  TOTAL`.padEnd(34) + `${tot[0]}`.padStart(10) + `${tot[1]}`.padStart(10) + `${tot[2]}`.padStart(6) + `${tot[3]}`.padStart(6));
      for (const [name, r] of sorted.slice(0, 40)) {
        console.log(`  ${name}`.padEnd(34) + `${r.tris}`.padStart(10) + `${r.shadowTris}`.padStart(10) + `${r.calls}`.padStart(6) + `${r.shadowCalls}`.padStart(6));
      }
    }
  }
  const runs = {};
  const info = {};
  for (const t of targetNames) {
    runs[t] = Object.fromEntries(configNames.map((n) => [n, []]));
    info[t] = {};
  }
  for (let r = 0; r < reps; r++) {
    // Rotate the order every repeat so slow drifts in machine load don't favour one config.
    const order = configNames.map((_, i) => configNames[(i + r * 7) % configNames.length]);
    for (const name of order) {
      for (const t of r % 2 ? [...targetNames].reverse() : targetNames) {
        const spec = { scale: baseScale, ...CONFIGS[name] };
        const res = await pages[t].evaluate(
          async ({ spec, frames, warm }) => {
            await window.__prof.set(spec);
            return window.__prof.measure(frames, warm);
          },
          { spec, frames, warm },
        );
        runs[t][name].push({ ms: median(res.ms), cpu: median(res.cpuMs) });
        info[t][name] = { draws: res.draws, triangles: res.triangles, size: `${res.width}x${res.height}` };
      }
    }
    console.log(`${view}: repeat ${r + 1}/${reps} done`);
  }
  results[view] = {};
  for (const t of targetNames) {
    const baseMs = median(runs[t].baseline?.map((x) => x.ms) ?? [NaN]);
    results[view][t] = {};
    for (const name of configNames) {
      const ms = median(runs[t][name].map((x) => x.ms));
      const cpu = median(runs[t][name].map((x) => x.cpu));
      results[view][t][name] = {
        ms: +ms.toFixed(1),
        cpuMs: +cpu.toFixed(1),
        vsBaseline: +(ms / baseMs).toFixed(3),
        ...info[t][name],
        runs: runs[t][name].map((x) => +x.ms.toFixed(1)),
      };
    }
  }
  for (const p of Object.values(pages)) await p.close();
  console.log(table(view, results[view]));
  writeFileSync(out, JSON.stringify(results, null, 2));
}
await browser.close();
server?.kill();
console.log(`\nwrote ${out}`);
