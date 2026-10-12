# Architecture

Hollow Star is a browser game: TypeScript + Vite + Three.js. Two players connect with a room code.

## Modules and ownership

Each folder has one owner (see PLAN.md §5). A module only imports another module through that module's `index.ts`.

| Folder | Owns | May import |
|---|---|---|
| `src/engine/` | Renderer, post-processing, game loop, input, camera | `three`, `postprocessing` |
| `src/game/` | World content, players, gameplay, state sync | `engine`, `net`, `config` |
| `src/net/` | Rooms, signaling, WebRTC, relay fallback, RTT | `@supabase/supabase-js`, `config`, `services` |
| `src/ui/` | DOM overlays: lobby, HUD, perf overlay, feedback box | `engine`, `net`, `telemetry` |
| `src/telemetry/` | Perf samples, error reports, feedback uploads | `services` |
| `src/services/` | Shared clients (the Supabase client singleton) | `@supabase/supabase-js`, `config` |
| `src/config.ts` | Public constants | nothing |

`src/main.ts` wires everything together.

## Net layer contract

The public types live in `src/net/types.ts`. `src/net/index.ts` exports:

```ts
createRoom(opts: NetOptions): Promise<Session> // resolves once the room exists (phase 'waiting')
joinRoom(code: string, opts: NetOptions): Promise<Session> // rejects if no host appears within ~10s, or room is full
```

- **Room codes:** 4 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no look-alikes). Codes are case-insensitive on join.
- **Signaling:** a per-room channel (`hs-room-<CODE>`) carries presence plus offer/answer/ICE messages.
  - `supabase`: Supabase Realtime channel (broadcast + presence).
  - `broadcast`: `BroadcastChannel`, with presence emulated by heartbeats.
- **Transport:** host creates the WebRTC offer. There are two data channels: `state` (`ordered: false, maxRetransmits: 0`) and `event` (reliable). If not connected within `p2pTimeoutMs`, both sides switch to relaying game messages over the signaling channel (`relay` for supabase, `local` for broadcast).
- **Max 2 players.** A third joiner is rejected with phase `failed`, detail `Room is full`.
- **RTT:** ping/pong on `event` every 2s, exponentially smoothed.
- **Reconnects:** if the other side's presence disappears, phase becomes `disconnected`. If they come back, the host re-offers.

## Game state sync (M0)

- Each player owns their own avatar and sends `{t:'pos', ...}` on `state` at `NET_SEND_HZ`.
- The remote avatar is drawn `NET_INTERP_DELAY_MS` in the past, interpolated between snapshots.
- From M2 on, the host owns enemies and world objects.

## Testing

- `npm test`: Vitest unit tests (pure logic: room codes, interpolation, message encoding).
- `npm run e2e`: Playwright opens two pages in one browser context, connects them through `broadcast` signaling with real WebRTC, and checks both players see each other move.
- `npm run shots`: photo mode. `/?shot=<name>` renders a fixed camera with a fixed seed and time, then sets `window.__shotReady = true`. The script saves PNGs to `shots/out/` for the visual critique loop.

## Telemetry

The game writes to Supabase tables `telemetry` (perf samples, errors) and `feedback` (F8 note + screenshot). The anon role can insert only; reading is done by the developer through the service role.
