# HOLLOW STAR: Unity port plan

Started 2026-10-13. The three.js version (everything outside `HollowStarUnity/`, `art/` and this file) is **frozen as reference**: we read it for gameplay rules, layout constants and tuning values, but don't develop it further. `PLAN.md` (vision, roles, chapters) and `docs/ART_BIBLE.md` (look) still apply. This file replaces PLAN.md sections 3, 4 and 6 for the Unity version.

## 0. Game direction (changed 2026-10-14)

Hollow Star is now a **co-op survival game in the spirit of Subnautica**, with realistic near-future tech. This replaces the action design in PLAN.md (roles with shields and guns, drone combat, boss fights). PLAN.md's story seeds (the dying star, the Hollow; the lost colony ship *Meridian*; the abandoned survey outpost) carry over.

- **Premise.** Two crew members crash-land the dropship *Wren* on an unexplored living planet that orbits the Hollow (working name **Vesper**; the name is yours and your dad's to choose). The *Wren* is too damaged to fly. To get home they must survive, explore, and rebuild it.
- **Core loop.** Explore, scan and gather (plants, minerals, ice, salvage), then craft at a fabricator, build and repair base modules, and grow food. Better gear opens up new biomes and deeper caves. Repair the *Wren* part by part, and launch at the end.
- **Survival.** Oxygen, food, water, body temperature (cold nights and shadow) and health. Hazards: storms, radiation flares from the Hollow, and terrain such as falls, cave-ins and thin ice. No guns, shields or combat.
- **Wildlife.** Grazers, scavengers and territorial predators. You read them, avoid them, scare them off with light or noise, and later tame or farm some. Creatures are part of the ecosystem, not enemies.
- **Base.** The abandoned survey outpost Kestrel-7 is your first shelter. Restore its power, oxygen and water; turn a hab into a greenhouse; add modules you build yourselves.
- **Story.** Objectives guide each chapter. Logs, scans and the *Meridian* wreck reveal what happened here. Chapter 1 ends with the *Wren* lifting off.
- **Co-op.** Two equal players with the same abilities and a shared base. Everything is also playable solo.
- **Look.** AAA target: realistic alien biomes (vegetation, water, fog, god rays, day/night with the Hollow huge in the sky), Blender-made assets. **UI:** a holographic suit HUD and a wrist PDA (inventory, crafting, scanner database, objectives, map) designed as a first-class feature.
- **Kept from the port:** the engine setup, terrain baking, astronaut and locomotion, camera, the *Wren* model, outpost layout and co-op networking. **Dropped:** drone combat (`Combat.cs`), shield and pulse abilities, the role split. The beacon mission (`Mission.cs`) becomes the first objective: restore the outpost's power.

## Token budget

Claude works within a usage limit, so:
- Subagents run on Sonnet with tight written specs; Opus does design, integration and review.
- Visual loops use one small contact sheet per round, at most 2 rounds per asset.
- Systems are built from code and data (rebuildable scripts), not by long chat iteration.

## 1. Decisions

| Topic | Choice | Why |
|---|---|---|
| Platform | **Native macOS app** (Apple Silicon, Metal) | Both players are on MacBook Air M4. Native gives far better graphics and performance than the browser. |
| Engine | Unity 6 (`6000.6.5f1`, already installed) | Installing another editor costs ~5-8 GB of disk we don't have. |
| Render pipeline | **URP** | HDRP is too heavy for a fanless M4 Air. URP covers PBR, cascaded shadows, SSAO, bloom, tonemapping and upscaling. |
| Models | **Blender 5.2** (installed), driven through the Blender MCP | Replaces the procedural geometry in `src/env/props` and `src/characters`. |
| Web version | Frozen as reference | Keeps the rules and numbers we tuned. |

## 2. What we have (three.js, as of 2026-10-12)

- **M0 Foundations: done.** Room codes, WebRTC with a Supabase relay fallback, perf overlay, telemetry, CI, Vercel deploy.
- **M1 Look-dev: mostly done.** The moon Vigil (heightfield terrain, rocks), Outpost Kestrel-7, the landing pad, the dropship *Wren*, the Meridian wreck, and the EVA-suit astronaut with procedural locomotion. All of it is built in code; there are no model files.
- **M2 Co-op core: partly done.** The beacon mission (3 steps: Vanguard, Tether, then both together), drone waves, attack/skill/dash/revive, solo bot partner with pathfinding. Traversal (climb, vault, grapple) and more puzzles are not built yet.

## 3. Mapping three.js to Unity

| three.js version | Unity version |
|---|---|
| TypeScript + Vite | C# with assembly definitions |
| `src/game/mission.ts`, `combat.ts`, `roles.ts`, `random.ts`, `env/layout.ts` | Ported almost line for line into `HollowStar.Core` (plain C#, no MonoBehaviours), so the logic stays testable |
| `src/env/terrain/heightfield.ts` | Ported to C# and used to generate a Unity Terrain heightmap, so crater, trench and vista corridor stay where gameplay expects them |
| Procedural props (outpost, pad, ship, wreck, debris) | Blender models exported as FBX, with baked PBR textures |
| Procedural astronaut + `locomotion.ts` | Blender model with a **Humanoid** rig, so standard humanoid animations retarget onto it |
| `engine/camera.ts` (3/4 camera) | Cinemachine camera with the same angle and zoom range |
| `engine/input.ts` | Input System package (keyboard, trackpad, gamepad) |
| `game/collision.ts`, `pathfinding.ts` | PhysX colliders, CharacterController, NavMesh (AI Navigation package) |
| `postprocessing` + N8AO (bloom, AO, god rays, SMAA, tonemapping, vignette, grain) | URP Volume (Bloom, Tonemapping, Color Adjustments, Vignette, Film Grain), the SSAO renderer feature, and a custom sun-shafts renderer feature (URP has no built-in god rays or volumetric fog) |
| `engine/resolution.ts` (dynamic resolution) | URP render scale with the STP upscaler, plus quality presets |
| WebRTC + Supabase signaling/relay, 4-letter room codes | **Netcode for GameObjects + Unity Multiplayer Services** (sessions with a join code, over Unity Relay). Works across two home networks without port forwarding |
| DOM HUD, lobby, feedback box | UI Toolkit |
| Supabase telemetry | Optional: POST to the existing tables with `UnityWebRequest` |
| Vitest unit tests | Unity Test Framework, EditMode (port the existing mission, combat and bot tests) |
| Playwright two-client tests | Multiplayer Play Mode (two players in one editor) |
| Vercel link | A zipped `.app` shared by AirDrop or Drive |

## 4. Asset pipeline (Blender to Unity)

- Blender sources live in `art/blender/*.blend`, **outside** the Unity project. Unity only sees exported FBX and PNG files. Importing `.blend` directly is slow and needs Blender on every machine.
- Export with one fixed script: metres, +Y up, transforms applied, one FBX per asset into `HollowStarUnity/Assets/_Project/Art/Models/`.
- Naming: `SM_` static mesh, `SK_` skinned mesh, `M_` material, `T_<asset>_BaseColor / _Normal / _MetallicSmoothness / _AO` textures.
- The art bible rules carry over: bevel every hard edge, dust on up-facing surfaces, grime low, paint chipped at edges, objects sunk into the regolith. In Blender this is a procedural weathering material, baked to textures at 1-2K.
- The Meridian is seen from 450-700 m. It needs a strong silhouette and LODs, not close-up detail.
- Budget per the art bible: < 2.5 M triangles on screen, only the sun casts shadows. Unity's SRP Batcher and GPU Resident Drawer replace manual instancing.

## 5. Milestones (each ends with a Mac build both of you can play)

| # | Milestone | Done when |
|---|---|---|
| U0 | **Setup** | Enough free disk, the Unity CLI and live-editor link work, Blender MCP is connected, the URP project exists with its packages, and an empty `.app` build runs on the Mac |
| U1 | **Walk on Vigil** | Ported layout constants and terrain, greybox outpost and pad, 3/4 camera, walk/sprint/dash, sun lighting from `SUN_DIR`. One hero asset (the astronaut) goes through the full Blender-to-Unity pipeline to prove it works |
| U2 | **Co-op link** | Two Macs join with a code and see each other move. The host owns the world. Solo mode |
| U3 | **Survival core** | Vitals (O2, food, water, temperature, health), inventory, scan-and-gather resource nodes, fabricator crafting, death and respawn, the holographic HUD and the PDA UI |
| U4 | **Living planet** | The new planet: biome terrain, GPU-instanced vegetation, water, day/night with the Hollow, weather, the crash site, first caves |
| U5 | **Base and farming** | Restore the outpost's power, O2 and water; build modules; greenhouse crops with growth stages; storage |
| U6 | **Wildlife** | Creature AI (grazers, scavengers, predators to avoid), scare-off tools, ecology |
| U7 | **Chapter 1 story** | Objective chain, logs and codex, the *Meridian* wreck, repairing the *Wren* from salvaged parts, the launch ending |
| always | **Art pass** | Every milestone ships with Blender assets and lighting at the AAA target, not greybox |

## 5b. Status

**U0 (2026-10-13): done, except the first `.app` build.** That build waits for U1, when there is something to walk around in.

- `HollowStarUnity/` is a URP project on Unity 6000.6.5f1. Added packages: Cinemachine, Netcode for GameObjects, Multiplayer Services, Multiplayer Play Mode, ProBuilder and the Pipeline package (lets Claude drive the open Editor). Visual Scripting and the Unity Version Control plugin were removed.
- The Unity CLI ships inside Unity Hub: `/Applications/Unity Hub.app/Contents/Resources/unity`. `unity status` shows the open Editor, and `unity command` lists what Claude can do in it (scenes, GameObjects, builds, captures, C# eval and more).
- The Blender MCP is connected to the running Blender.
- Code layout: `Assets/_Project/Scripts/Core` (`HollowStar.Core`: plain C# with no Unity references) and `Assets/_Project/Tests/EditMode`.
- Ported so far: `Mission`, `Combat`, `Mulberry32` (bit-for-bit the same sequence as the web version), `Layout` (gameplay positions) and the roles. All 11 EditMode tests pass: the web version's mission and combat tests plus the RNG check.
- Coordinates use the same numbers as the web version. Unity is left-handed, so the world is a mirror image of the web one, which nobody can see in play.

**U1 (2026-10-13): walkable.** Scene `Assets/_Project/Scenes/Vigil.unity`, rebuilt from code with *Hollow Star > Build Vigil Scene*.

- **Terrain:** `HollowStar.Core.Terrain.TerrainModel` is a double-precision port of `heightfield.ts`, including the `simplex-noise` package. A test checks it against heights sampled from the web version in Node, and they match to 1e-7. `VigilTerrainBuilder` bakes two Unity terrains: 2 km near (about 1 m grid, with collider) and 20 km far (20 m grid, with a hole where the near one sits). The outpost apron stays exactly at y = 0.
- **Ground textures:** procedural regolith, basalt and ejecta stand-ins (`ProceduralTextures`). Splat weights come from the model's rock and brightness hints plus slope.
- **Outpost greybox:** `OutpostGreyboxBuilder` places pad, *Wren*, habs, tunnels, containers, crates, rover, mast, cabinet, pedestal, floodlights, tanks and solar array from `Data/OutpostLayout.json`, which was exported from the web version's `props/layout.ts`.
- **Lighting:** the Hollow as key light from `SUN_DIR`, Orrin bounce, trilight ambient, haze fog, a procedural sky, and URP post (ACES, bloom, grade, vignette).
- **Player:** `PlayerMotor` uses the web version's tuning (walk 5.2, sprint 8.4, dash 15 m/s). `PlayerControls` binds keyboard, trackpad and gamepad. `CameraRig` is a port of the 3/4 orbit camera with ground and obstacle avoidance.
- **Astronaut:** `art/blender/scripts/build_astronaut.py` models, rigs, skins and exports `SK_Astronaut.fbx` (about 40k triangles) with the web rig's joint table. Bones import unrotated, so `Locomotion.cs`, a line-by-line port of `locomotion.ts` (gait, foot IK, lean, breathing, look-around, backpack springs), drives them directly. Role accent materials swap per role.
- **Editor link:** with the Editor unfocused, play mode stops ticking. Captures need `editor_focus` first.
- **Not done yet:** UVs and textures on the suit; the sky has no proper Hollow disc yet (needs a custom sky shader, U4); dash is untested with simulated keys.

**U2 (2026-10-14): co-op link works over Relay.** Tested with two copies of the `.app` on one Mac, joined by code through Unity Relay.

- **Rooms:** `SessionFlow` creates a two-seat Multiplayer Services session over Relay (6-letter code, case-insensitive), joins by code, plays solo (a host on loopback, no Unity Services needed) and leaves. `ServicesBootstrap` signs in anonymously with a per-copy profile (`-hs-profile`, else random), so two copies on one Mac count as two players. The project is linked to Unity Cloud; builds carry the project id.
- **Players:** `Prefabs/NetPlayer.prefab` (built by `CoopBuilder`). Each machine simulates its own character and streams it with an owner-authoritative NetworkTransform, as in the web version. The other copy has no controller or input; its avatar reads speed and heading from the transform, so it walks and turns properly. The server places players at `Layout.SpawnPoints` and turns away a third. `RoleId` now only picks the suit accent: host orange, guest teal. Both players are equal.
- **Leaving:** if the partner leaves or crashes, the host keeps playing, sees "Partner disconnected" and frees the seat, so the same code works again. If the host leaves, the guest returns to the menu with "The host left the room." A crashed partner is only noticed after the transport's 30 s timeout.
- **UI:** a UI Toolkit lobby and HUD built in code (`LobbyUI`). The HUD shows the room code (with Copy), host or guest, partner status, Relay and round-trip time. Typing in the code field doesn't move the player.
- **Test switches:** `-hs-auto host|join:CODE|solo`, `-hs-autowalk`, `-hs-autoleave N`. Both sides log `[HollowStar] partner at (x, z)` every 2 s.
- **Fixed from U1:** cylinder props used capsule colliders, which turned the flat landing pad into a 13 m invisible dome. They now use mesh colliders.

**U3 (2026-10-15): survival core.** Spec: `docs/U3_SURVIVAL_SPEC.md`. 102 EditMode tests pass. Solo was checked in play mode, and co-op with two `.app` copies over Relay.

- **Core (`Scripts/Core/Survival/`, pure C#, tested):**
  - Items and recipes; inventory (24 slots plus a 5-key hotbar); crafting.
  - Vitals (O2, food, water, body temperature, health), suit gear and the game clock (20 min day).
  - Databank, the seeded resource scatter and the objective chain.
- **Seam:** gameplay and UI talk only through `Game/Survival/SurvivorHub.cs`. Gameplay writes the state and handles requests; the UI reads, and sends Use, Craft, Drop and hotbar requests.
- **Gameplay (`Game/Survival/`):**
  - **`Survivor`:** owns the local player's inventory, vitals and databank. Hotbar use, crafting with a timer (cancelled if you walk away), and death with a respawn in the *Wren* bay after 8 s.
  - **Look-at interaction:** hold F to gather (1.2 s), hold V to scan (1.5 s).
  - **Nodes:** about 70 resource nodes baked by `ResourceNodeBuilder` with stand-in meshes.
  - **`WorldState`:** one NetworkObject holds node depletion and the host's clock. Gathering is a server RPC, and the yield goes back only to the gatherer.
  - **Pressurised zones** in the bay and the habs. Partner health and oxygen are synced through NetPlayer.
- **The *Wren*:**
  - `SM_Wren.fbx` replaces the greybox (`WrenBuilder`: URP materials, colliders, walkable ramp).
  - The bay zone, fabricator console, respawn points and session spawns are children of the *Wren* root (`WrenAnchors`), so the ship can move to a crash site in U4.
- **UI:** the browser version's style is ported to UI Toolkit.
  - `Theme.uss`, `Hud.uss`, `Pda.uss`, `Lobby.uss`; Orbitron and Rajdhani SDF fonts; vector item glyphs drawn with Painter2D.
  - HUD: vitals, hotbar, compass, toasts, prompt and scan ring, partner card, death screen. PDA on Tab: Inventory, Fabricator, Databank, Objectives. New lobby.
  - `-hs-uipreview` (or *Hollow Star > UI Preview*) fills the hub with fake data for screenshots.
- **Removed:** drone combat (`Combat.cs`).
- **Tuning choices:**
  - Respawn lifts food and water to at least 10.
  - Lumen bulbs and resin pods need no cutter, because the cutter's battery is made from them.
  - "Find water" completes on gathering ice or crafting filtered water.
- **Not done yet:**
  - Inventory drag-and-drop.
  - Drop deletes the stack instead of placing it in the world.
  - Hab zones are unreachable until the habs get doors (U5).
  - Nodes are primitive stand-ins (Blender models in U4).
  - The sky is still dark (U4).

## 6. Visual loop in Unity

Same loop as PLAN.md section 6, but now on the real Mac GPU:

1. An editor script renders fixed shot cameras to PNG (Unity) and `render_viewport_to_path` does the same for Blender models.
2. Claude reviews the images against the art bible rubric and makes concrete changes.
3. Stop at 8/10 or after 4 rounds.

Frame rates are real now, since the renders run on the M4, not in a cloud container without a GPU.

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Disk is 96% full (8.4 GB free on 2026-10-13)** | Free at least 15 GB before U0. Unity `Library/` alone grows to several GB |
| 16 GB RAM with Unity, Blender and Claude open together | Close Blender while doing Unity builds |
| Unsigned app: macOS blocks it on first launch | Right-click the app, then Open (once per Mac). Notarizing needs a paid Apple Developer account and is optional |
| Unity Relay needs a Unity Cloud project | You sign in once and link the project in U2. The free tier covers two players |
| URP lacks volumetric fog and god rays | A small custom renderer feature (screen-space sun shafts plus height fog in the shaders) |
| AI-made Blender models look "programmer art" | The hero-asset test in U1 proves the pipeline before we build the rest. CC0 textures (Poly Haven, ambientCG) as a base if the network allows it |

## 8. Open questions

- Git: the local folder isn't a git repo. Do we put the Unity project in the same GitHub repo as the web version (with Git LFS for FBX/PNG/blend), or in a new repo?
- Do we keep Supabase telemetry, or is it enough that you two playtest and send screenshots?
