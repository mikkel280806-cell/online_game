import { defineConfig } from 'vite';

// Stamp builds with the commit so telemetry can tell versions apart.
const build = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(build),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, strictPort: true },
});
