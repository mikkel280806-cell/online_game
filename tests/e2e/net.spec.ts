// Real-browser test of the net layer: pages in one browser context talk through
// BroadcastChannel signaling and real WebRTC data channels.
//
// Self-contained: starts its own Vite dev server (no app build needed), so it runs under the
// root playwright.config.ts or alone with `npx playwright test -c tests/e2e/net.config.ts`.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import type { Channel, NetMessage, NetOptions, SessionStatus } from '../../src/net/types';

interface JoinResult {
  ok: boolean;
  ms: number;
  code?: string;
  message?: string;
  status?: SessionStatus;
}

/** Shape of window.hs from tests/e2e/net-harness.html. */
interface Harness {
  host(opts: NetOptions): Promise<{ code: string; status: SessionStatus }>;
  join(code: string, opts: NetOptions): Promise<JoinResult>;
  send(ch: Channel, m: NetMessage): void;
  status(): SessionStatus | null;
  rtt(): number | null;
  inbox(): { ch: Channel; m: NetMessage }[];
  statuses(): SessionStatus[];
  close(): void;
}
type HarnessWindow = { hs: Harness; __netReady?: boolean };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// No STUN/TURN is reachable from CI containers; same-machine host candidates are enough.
const P2P: NetOptions = { signaling: 'broadcast', iceServers: [] };

// Real IPs instead of mDNS .local names for host candidates (mDNS doesn't resolve in containers).
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  },
});
test.describe.configure({ mode: 'serial' });

let server: ViteDevServer;
let harnessUrl: string;

test.beforeAll(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    cacheDir: path.join(os.tmpdir(), 'hollow-star-net-e2e-vite'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 5174, strictPort: false, hmr: false, fs: { strict: false } },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('vite did not report a URL');
  harnessUrl = new URL('tests/e2e/net-harness.html', base).href;
});

test.afterAll(async () => {
  await server?.close();
});

async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[console.${msg.type()}] ${msg.text()}`);
  });
  await page.goto(harnessUrl);
  await page.waitForFunction(() => (window as unknown as HarnessWindow).__netReady === true);
  return page;
}

const host = (page: Page, opts: NetOptions) =>
  page.evaluate((o) => (window as unknown as HarnessWindow).hs.host(o), opts);
const join = (page: Page, code: string, opts: NetOptions) =>
  page.evaluate(([c, o]) => (window as unknown as HarnessWindow).hs.join(c, o), [code, opts] as const);
const status = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).hs.status());
const send = (page: Page, ch: Channel, m: NetMessage) =>
  page.evaluate(([c, msg]) => (window as unknown as HarnessWindow).hs.send(c, msg), [ch, m] as const);
const inbox = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).hs.inbox());

async function waitConnected(page: Page, timeout = 15_000): Promise<SessionStatus> {
  await page.waitForFunction(
    () => (window as unknown as HarnessWindow).hs.status()?.phase === 'connected',
    undefined,
    { timeout },
  );
  return (await status(page))!;
}

async function exchange(a: Page, b: Page): Promise<void> {
  // 'state' is unreliable by design; a few copies make the check robust anyway.
  for (let i = 0; i < 3; i++) {
    await send(a, 'state', { t: 'pos', from: 'a', i });
    await send(b, 'state', { t: 'pos', from: 'b', i });
  }
  await send(a, 'event', { t: 'door', from: 'a', id: 1 });
  await send(a, 'event', { t: 'door', from: 'a', id: 2 });
  await send(b, 'event', { t: 'chat', from: 'b', text: 'hej' });

  for (const [page, other] of [
    [b, 'a'],
    [a, 'b'],
  ] as const) {
    await expect
      .poll(async () => {
        const box = await inbox(page);
        return {
          state: box.some((e) => e.ch === 'state' && e.m.t === 'pos' && e.m.from === other),
          events: box.filter((e) => e.ch === 'event').map((e) => e.m),
        };
      })
      .toEqual({
        state: true,
        events:
          other === 'a'
            ? [
                { t: 'door', from: 'a', id: 1 },
                { t: 'door', from: 'a', id: 2 },
              ]
            : [{ t: 'chat', from: 'b', text: 'hej' }],
      });
  }
}

test('P2P: host and guest connect over WebRTC data channels', async ({ context }) => {
  const hostPage = await openPage(context);
  const guestPage = await openPage(context);

  const room = await host(hostPage, P2P);
  expect(room.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  expect(room.status.phase).toBe('waiting');

  const joined = await join(guestPage, room.code.toLowerCase(), P2P);
  expect(joined).toMatchObject({ ok: true });

  const [hs, gs] = await Promise.all([waitConnected(hostPage), waitConnected(guestPage)]);
  expect(hs.transport).toBe('p2p');
  expect(gs.transport).toBe('p2p');

  await exchange(hostPage, guestPage);

  for (const page of [hostPage, guestPage]) {
    await expect
      .poll(() => page.evaluate(() => (window as unknown as HarnessWindow).hs.rtt()), { timeout: 10_000 })
      .toEqual(expect.any(Number));
  }
  const statuses = await hostPage.evaluate(() => (window as unknown as HarnessWindow).hs.statuses());
  expect(statuses.map((s) => s.phase)).toEqual(['connecting', 'connected']);
});

test('forceRelay: messages go over BroadcastChannel (transport "local")', async ({ context }) => {
  const hostPage = await openPage(context);
  const guestPage = await openPage(context);
  const opts: NetOptions = { ...P2P, forceRelay: true };

  const room = await host(hostPage, opts);
  expect(await join(guestPage, room.code, opts)).toMatchObject({ ok: true });

  const [hs, gs] = await Promise.all([waitConnected(hostPage), waitConnected(guestPage)]);
  expect(hs.transport).toBe('local');
  expect(gs.transport).toBe('local');
  await exchange(hostPage, guestPage);
  await expect
    .poll(() => guestPage.evaluate(() => (window as unknown as HarnessWindow).hs.rtt()))
    .toEqual(expect.any(Number));
});

test('a third player is rejected with "Room is full"', async ({ context }) => {
  const hostPage = await openPage(context);
  const guestPage = await openPage(context);
  const thirdPage = await openPage(context);

  const room = await host(hostPage, P2P);
  expect(await join(guestPage, room.code, P2P)).toMatchObject({ ok: true });
  await Promise.all([waitConnected(hostPage), waitConnected(guestPage)]);

  const third = await join(thirdPage, room.code, P2P);
  expect(third).toMatchObject({ ok: false, message: 'Room is full', code: 'room-full' });
  expect(third.ms).toBeLessThan(5000);

  // The original pair is unaffected.
  expect((await status(hostPage))?.phase).toBe('connected');
  expect((await status(guestPage))?.phase).toBe('connected');
  await send(hostPage, 'event', { t: 'still-here' });
  await expect.poll(async () => (await inbox(guestPage)).map((e) => e.m.t)).toContain('still-here');
});

test('joining an unknown room rejects with "Room not found"', async ({ context }) => {
  test.setTimeout(30_000);
  const page = await openPage(context);
  const result = await join(page, 'WXYZ', P2P);
  expect(result).toMatchObject({ ok: false, message: 'Room not found', code: 'room-not-found' });
  expect(result.ms).toBeGreaterThan(9000);
  expect(result.ms).toBeLessThan(12_000);

  const bad = await join(page, 'no', P2P);
  expect(bad).toMatchObject({ ok: false, code: 'invalid-code' });
});

test('guest leaving shows disconnected; a new guest reconnects over P2P', async ({ context }) => {
  const hostPage = await openPage(context);
  const guestPage = await openPage(context);
  const room = await host(hostPage, P2P);
  expect(await join(guestPage, room.code, P2P)).toMatchObject({ ok: true });
  await Promise.all([waitConnected(hostPage), waitConnected(guestPage)]);

  await guestPage.close(); // pagehide → leave; data channels close
  await hostPage.waitForFunction(
    () => (window as unknown as HarnessWindow).hs.status()?.phase === 'disconnected',
    undefined,
    { timeout: 5000 },
  );

  const nextPage = await openPage(context);
  expect(await join(nextPage, room.code, P2P)).toMatchObject({ ok: true });
  const [hs, gs] = await Promise.all([waitConnected(hostPage), waitConnected(nextPage)]);
  expect(hs.transport).toBe('p2p');
  expect(gs.transport).toBe('p2p');
  await exchange(hostPage, nextPage);
});
