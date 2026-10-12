# HOLLOW STAR — Build Plan (working title)

A 2-player co-op, story-driven space action-adventure for two MacBook Air M4s, played in the browser.

## 1. Vision

**Pitch.** A century-lost colony ship, the *Meridian*, drops out of hyperspace beside a dying star. Two salvagers board it and find a ship that is still alive, and a story that isn't what the logs say. The player-owned salvage ship is the hub; derelicts, moons and stations are the chapters.

**What each of you gets from the references**
| Source | What we borrow |
|---|---|
| Zelda (dad) | Dungeon-style rooms, items that unlock the world, puzzles that need both players |
| Assassin's Creed (you) | Fluid traversal (climb, vault, grapple), stealth takedowns, a lore codex |
| World of Warcraft (both) | Two complementary classes, loot/talents, boss fights with roles |
| Space | Ship hub, co-op flight sequences (pilot + gunner), star-and-nebula skies |

**Two roles (co-op is the core, neither is a sidekick)**
- **Vanguard:** melee, traversal, shield, breaks things.
- **Tether:** ranged tech, hacking, gravity tether and drone; reveals hidden paths.
- Every puzzle and boss has a step only one role can do and a step that needs both.

**Camera: 3/4 angled (Hades / Link's Awakening style), not free third-person.** The camera decides what the player sees, so the art budget goes into a controlled frame. This is what makes "looks AAA" achievable. A free camera can come later.

## 2. Honest scope and graphics target

- True AAA needs a studio and authored assets. The target is **stylized, cinematic, polished**: strong PBR lighting, bloom, SSAO, volumetric fog and god-rays, GPU particles, procedural nebula skies, color-graded per chapter.
- **Scope is chapter-based.** Each chapter is 20-30 minutes, playable end to end, and is a release. We never have a half-built giant world.
- Free CC0 assets (Kenney, Quaternius, Poly Haven) would help, **but I have not verified the cloud network can reach them.** Fallback is procedural geometry and shaders, which works regardless.

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language/build | TypeScript + Vite | Fast, typed, easy to test |
| Rendering | Three.js (WebGL2) + postprocessing | Mature; M4 handles it well. WebGPU is a later experiment |
| Physics | Rapier (WASM) | Deterministic, fast |
| Netcode | WebRTC data channels, Supabase Realtime for signaling and as a relay fallback | Works across different home networks |
| Model | Each player owns their own character; host owns enemies and world state | Feels responsive without a dedicated server |
| Audio | WebAudio, fully synthesized music and SFX | No asset files needed |
| Hosting | Vercel (static) | One link to open on both Macs |
| Telemetry | Supabase table | Your real FPS, errors and feedback reach me |
| CI | GitHub Actions | Tests and a screenshot suite on every PR |

**M4 Air specifics:** it is fanless and will throttle in long sessions. Target 60 fps with dynamic resolution scaling, a quality toggle, and a visible perf overlay.

**Controls:** WASD + mouse/trackpad, with every ability on the keyboard (no right-click drag). The Gamepad API is supported if you have controllers. Optional built-in voice chat over the same WebRTC link.

## 4. Milestones (every one ends with a playable link)

| # | Milestone | Done when |
|---|---|---|
| M0 | **Foundations** | Repo, CI, Vercel deploy, room codes, both Macs see each other move in a lit scene, perf overlay and telemetry work. Retires the networking risk first |
| M1 | **Look-dev slice** | One gorgeous room plus a walking character, with an art bible, run through the visual loop (section 6). Locks the look *before* building systems |
| M2 | **Co-op core** | Both roles, traversal, combat, abilities, enemies, one two-player puzzle |
| M3 | **Chapter 1** | Derelict ship level, cutscenes, dialogue, boss, music. The first complete story slice |
| M4 | **Ship flight** | Cockpit co-op: pilot + gunner, space combat, hub ship |
| M5 | **Chapter 2+** | Loot and talents, more worlds, polish |

## 5. Subagent plan

The main session is the **Director**: it owns the design doc, architecture, merging and the budget. Subagents work in separate **git worktrees** so they don't collide, and each gets a narrow task and a written interface contract (`docs/ARCHITECTURE.md`).

| Agent | Owns | Model tier |
|---|---|---|
| Engine | Renderer, physics, input, asset pipeline, game loop | Strong |
| Net | WebRTC, signaling, snapshots, reconnects | Strong |
| Gameplay | Roles, abilities, combat, enemies, puzzles | Strong |
| Art/VFX | Shaders, post-processing, materials, particles, skyboxes | Strong |
| Level | Room layouts, lighting passes, set dressing | Mid |
| Narrative | Script, dialogue data, codex entries (with you and your dad) | Mid |
| QA | Playwright two-client bots, deterministic sim tests | Cheap |
| Critic | Looks at screenshots, scores against the art bible | Mid, vision |

Rules: agents don't run in parallel unless their tasks are independent. Each returns a short report, and the Director verifies the code before merging.

## 6. The visual loop ("render, critique, refine")

1. A **photo-mode harness** (`?shot=name`) renders fixed cameras with a fixed seed and time in headless Chromium.
2. Screenshots are composed into one small contact sheet (cheap in tokens).
3. The **Critic** scores it against a rubric: silhouette readability, value contrast, palette discipline, lighting direction, depth and fog, bloom not blown out, UI legibility. It returns a ranked list of concrete changes.
4. The **Art/VFX** agent patches, and we re-render and diff.
5. **Stop** at a rubric score of 8/10 or after 4 iterations, whichever comes first.

**Limit:** the cloud has no GPU, so it renders in software. Colors and composition are reliable, but frame rate isn't. The real tests are on your Macs, where the game reports FPS, errors and screenshots-with-notes back to a Supabase table that I can read.

## 7. Budget discipline (Pro plan + $100 credits)

I can't see your billing, so check your usage after each milestone.

- Strong model for architecture and hard systems; cheaper tiers for narrow tasks.
- Screenshots are small (about 960x540) and batched into contact sheets.
- Visual loops are capped at 4 iterations.
- Rough split: 10% planning, 50% building, 25% visual polish, 15% reserve.
- **Gate:** at the end of each milestone I stop, summarize what was built, and wait for your go-ahead.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Strict home routers block P2P | Supabase relay fallback, built in M0 |
| Scope creep | Chapter-based releases; cut features, not quality |
| Graphics can't be judged in the cloud | Real-Mac telemetry plus your screenshots |
| M4 Air thermal throttling | Dynamic resolution, quality toggles |
| Story needs your taste | Narrative drafts go to you and your dad for approval before they're built |
