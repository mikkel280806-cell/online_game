import { expect, test, type Page } from '@playwright/test';

// Same-browser multiplayer: BroadcastChannel signaling, real WebRTC over host candidates.
// The cloud renders in software at a few fps, so keep rendering cheap and never assume timing.
const URL = '/?net=local&ice=none&telemetry=0&quality=low';

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
  let last = (await state(page)).local!;
  await expect
    .poll(async () => {
      const p = (await state(page)).local!;
      const moved = Math.hypot(p.x - last.x, p.z - last.z);
      last = p;
      return moved;
    }, { timeout: 10_000, intervals: [1000] })
    .toBeLessThan(0.001);
}

test('solo: explore alone and walk', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.getByTestId('solo').click();
  await expect.poll(async () => (await state(page))?.phase).toBe('solo');
  const before = await state(page);
  await walk(page, 'KeyD');
  const after = await state(page);
  expect(after.local!.x).toBeGreaterThan(before.local!.x + 2);
  expect(Math.abs(after.local!.z - before.local!.z)).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

for (const relay of [false, true]) {
  test(`two players connect and see each other move (${relay ? 'relay' : 'p2p'})`, async ({ context }) => {
    const url = URL + (relay ? '&relay=1' : '');
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto(url);
    await b.goto(url);

    await a.getByTestId('create').click();
    const code = a.locator('.hud .code');
    await expect(code).toHaveText(/^[A-Z0-9]{4}$/);
    await b.getByLabel('Room code').fill((await code.textContent())!);
    await b.getByTestId('join').click();

    for (const p of [a, b]) {
      await expect.poll(async () => (await state(p))?.phase, { timeout: 20_000 }).toBe('connected');
    }
    expect((await state(a)).transport).toBe(relay ? 'local' : 'p2p');
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
  });
}
