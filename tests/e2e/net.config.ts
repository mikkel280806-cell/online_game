// Standalone config for the net layer e2e test: `npx playwright test -c tests/e2e/net.config.ts`.
// Unlike the root config it does not build the app; net.spec.ts starts its own Vite dev server.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'net.spec.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
