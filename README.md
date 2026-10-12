# Hollow Star

A two-player co-op space adventure that runs in the browser. See [PLAN.md](PLAN.md) for the vision and roadmap, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code fits together.

## Play

1. Both players open **https://hollow-star.vercel.app** in Chrome or Safari.
2. One player clicks **Create room** and reads out the 4-letter code.
3. The other types the code and clicks **Join**.

| Input | Action |
|---|---|
| W A S D / arrows | Move (relative to the camera) |
| Shift | Sprint |
| F (hold) | Interact: force, hack, throw breakers |
| R | Attack: Vanguard strikes, Tether fires a pulse shot (auto-aims) |
| C | Vanguard: hold the shield up · Tether: gravity pulse (stuns and pulls drones) |
| Space | Dash |
| Drag, two-finger swipe, Q / E | Turn the camera |
| Scroll / pinch | Zoom |
| B | Solo: add or dismiss the bot partner |
| H | Hide the HUD (for screenshots) |
| F3 | Performance stats |
| F8 | Send feedback with a screenshot (goes straight to the developer) |

**Solo:** "Play solo with a bot partner" starts you with an AI crewmate who follows you, catches up, and wanders off to look at things when you stand still.

URL options: `?quality=low|medium|high`, `?scale=0.5` (render resolution cap), `?relay=1` (force the relay connection), `?bot=0` (solo without the bot), `?telemetry=0`.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run e2e        # two-player browser tests (builds first)
npm run shots      # photo-mode screenshots into shots/out/ (needs a build)
```

Offline two-tab testing: open `http://localhost:5173/?net=local` in two tabs of the same browser.
