# Hollow Star

A two-player co-op space adventure that runs in the browser. See [PLAN.md](PLAN.md) for the vision and roadmap, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code fits together.

## Play

1. Both players open **https://hollow-star-mikkel7.vercel.app** in Chrome or Safari.
2. One player clicks **Create room** and reads out the 4-letter code.
3. The other types the code and clicks **Join**.

| Key | Action |
|---|---|
| W A S D / arrows | Move |
| Shift | Sprint |
| F3 | Performance stats |
| F8 | Send feedback with a screenshot (goes straight to the developer) |

URL options: `?quality=low|medium|high`, `?relay=1` (force the relay connection), `?telemetry=0`.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run e2e        # two-player browser tests (builds first)
npm run shots      # photo-mode screenshots into shots/out/ (needs a build)
```

Offline two-tab testing: open `http://localhost:5173/?net=local` in two tabs of the same browser.
