import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Same-browser multiplayer: BroadcastChannel signaling, real WebRTC over host candidates.
// The cloud renders in software at a few fps, so keep rendering cheap and never assume timing.
const URL = '/?net=local&ice=none&telemetry=0&quality=low&scale=0.4&p2ptimeout=30000';

type HS = NonNullable<Window['__hs']>;
const state = (page: Page) => page.evaluate(() => window.__hs as HS);

/** Hold a key until the local player has moved `dist` metres (frame-rate independent). */
async function walk(page: Page, key: string, dist = 2.5) {
  const start = (await state(page)).local!;
  await page.keyboard.down(key);
  await expect
    .poll(async () => {
      const p = (await state(page)).local!;
      return Math.hypot(p.x - start.x, p.z - start.z);
    }, { timeout: 20_000 })
    .toBeGreaterThan(dist);
  await page.keyboard.up(key);
  // Wait for the slide to stop so callers read the resting position.
  await expect.poll(async () => (await state(page)).local!.speed, { timeout: 10_000 }).toBeLessThan(0.01);
}

test('solo: walk around with the bot partner following', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.getByTestId('solo').click();
  await expect.poll(async () => (await state(page))?.phase, { timeout: 30_000 }).toBe('solo');
  expect((await state(page)).bot).not.toBeNull();
  const before = await state(page);
  await walk(page, 'KeyD', 8);
  const after = await state(page);
  expect(after.local!.x).toBeGreaterThan(before.local!.x + 7);
  // The bot catches up and stays close without walking into us.
  await expect
    .poll(async () => {
      const s = await state(page);
      return Math.hypot(s.bot!.x - s.local!.x, s.bot!.z - s.local!.z);
    }, { timeout: 60_000 })
    .toBeLessThan(6);
  expect(errors).toEqual([]);
});

/** Two pages join the same room, check roles, movement sync both ways, and disconnect. */
async function playTogether(context: BrowserContext, url: string, transport: string) {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto(url);
  await b.goto(url);

  await a.getByTestId('create').click();
  const code = a.locator('.hud .code');
  await expect(code).toHaveText(/^[A-Z0-9]{4}$/, { timeout: 20_000 });
  await b.getByLabel('Room code').fill((await code.textContent())!);
  await b.getByTestId('join').click();

  for (const p of [a, b]) {
    await expect.poll(async () => (await state(p))?.phase, { timeout: 30_000 }).toBe('connected');
  }
  expect((await state(a)).transport).toBe(transport);
  expect((await state(a)).role).toBe('vanguard');
  expect((await state(b)).role).toBe('tether');

  // Each side sees the other.
  await expect.poll(async () => (await state(b)).remote !== null, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await state(a)).remote !== null, { timeout: 10_000 }).toBe(true);

  // A walks right; B sees A arrive where A is.
  await walk(a, 'KeyD');
  const aPos = (await state(a)).local!;
  await expect
    .poll(async () => {
      const r = (await state(b)).remote;
      return r ? Math.hypot(r.x - aPos.x, r.z - aPos.z) : Infinity;
    }, { timeout: 15_000 })
    .toBeLessThan(0.3);

  // B walks up; A sees it.
  await walk(b, 'KeyW');
  const bPos = (await state(b)).local!;
  await expect
    .poll(async () => {
      const r = (await state(a)).remote;
      return r ? Math.hypot(r.x - bPos.x, r.z - bPos.z) : Infinity;
    }, { timeout: 15_000 })
    .toBeLessThan(0.3);

  // A leaves; B is told.
  await a.close();
  await expect.poll(async () => (await state(b)).phase, { timeout: 15_000 }).toBe('disconnected');
}

for (const relay of [false, true]) {
  test(`two players connect and see each other move (${relay ? 'relay' : 'p2p'})`, async ({ context }) => {
    // Two pages share one software-rendered CPU in CI containers; give them room.
    test.setTimeout(300_000);
    await playTogether(context, URL + (relay ? '&relay=1' : ''), relay ? 'local' : 'p2p');
  });
}

// The real internet path: Supabase Realtime for presence and signaling (and as relay).
// Needs network access to Supabase, which CI has and the dev container may not.
test.describe('over Supabase Realtime', () => {
  test.skip(!process.env.E2E_SUPABASE, 'set E2E_SUPABASE=1 to run (needs internet)');
  const NET_URL = '/?telemetry=0&quality=low&scale=0.4&p2ptimeout=30000';

  for (const relay of [false, true]) {
    test(`two players connect over the internet (${relay ? 'relay' : 'p2p'})`, async ({ context }) => {
      test.setTimeout(300_000);
      await playTogether(context, NET_URL + (relay ? '&relay=1' : ''), relay ? 'relay' : 'p2p');
    });
  }
});
