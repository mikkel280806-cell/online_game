# U3: Survival core: spec

Shared spec for the agents building U3. Read `UNITY_PLAN.md` section 0 (game direction) first. Unity project: `HollowStarUnity/`. Pure logic goes in `Assets/_Project/Scripts/Core` (`HollowStar.Core`, no UnityEngine) with EditMode tests; Unity glue goes in `Scripts/Game`, editor builders in `Scripts/Editor`. The look and feel of the UI must match the browser version (`src/ui/style.css`); see section 6.

## 1. Vitals (each player owns their own; 0..100 unless noted)

| Vital | Rule (tuning constants in one place) |
|---|---|
| Oxygen | Outdoors the air is thin: the suit tank drains 100 over 300 s (bigger tanks raise capacity). Inside a pressurised zone (Wren bay, outpost habs) it refills at 25/s. At 0, health -5/s. |
| Food | -100 over 40 min. At 0, health -0.5/s. |
| Water | -100 over 25 min. At 0, health -0.8/s. |
| Body temp (°C) | Normal 37. Drifts toward a target set by ambient temperature, suit insulation and shelter (a zone counts as 20 °C). Below 35 °C, health -1/s; above 39.5 °C, health -1/s. |
| Health | Regenerates +0.5/s when food > 20, water > 20, oxygen > 0 and temperature is OK. |

- **Death:** the screen fades, the player respawns at the *Wren* bay with health 50, oxygen 100 and food and water unchanged, after 8 s. The inventory is kept for now (tuned later).
- **Game clock (shared, the host's value):** one full day lasts 20 real minutes, starting at 0.30 (morning). Ambient temperature follows a cosine: about 16 °C at midday and -14 °C at midnight. Expose sun elevation for lighting (U4 makes the sky).

## 2. Items and recipes (data in Core: `ItemCatalog`, `Recipes`)

Items have an id, name, short description, category (Raw, Material, Food, Tool, Equipment, Consumable), max stack, and an icon glyph id (section 6).

- **Raw:** `ferrite_ore`, `copper_ore`, `silica_sand`, `quartz`, `ice_chunk`, `fiber_reed`, `amber_resin`, `scrap_metal`, `salvaged_wiring`, `lumen_bulb`, `sporeberry` (food +12, water +4), `ground_tuber` (food +8; raw tubers are bland).
- **Crafted:** `metal_plate` (2 ferrite), `copper_wire` (1 copper), `glass` (2 silica), `fiber_mesh` (2 fibre reed), `battery` (1 copper + 1 lumen bulb + 1 resin), `filtered_water` (1 ice, gives water +30), `baked_tuber` (2 tubers, food +30), `ration_bar` (1 tuber + 2 sporeberries, food +40), `o2_canister` (1 metal plate + 1 glass, a consumable that gives oxygen +50), `medkit` (2 fibre mesh + 1 resin, health +50).
- **Tools and equipment:** `scanner` (1 battery + 1 copper wire + 1 glass), `cutter` (1 metal plate + 1 battery; needed to harvest plants), `flashlight` (1 battery + 1 glass), `repair_tool` (1 metal plate + 1 copper wire + 1 battery), `hc_o2_tank` (3 metal plate + 1 glass + 1 wiring; doubles oxygen capacity), `thermal_liner` (3 fibre mesh + 1 resin; +insulation).
- **Starting kit (each player):** scanner, 2 ration bars, 2 filtered water, 1 o2 canister.
- **Fabricator:** a station in the *Wren* bay; every recipe needs it except `filtered_water`, `baked_tuber` and `ration_bar`, which can also be made at the galley in the same bay (treat it as the same station for U3). Crafting takes 2–4 s and is cancelled if you walk away.

## 3. Inventory and crafting (Core)

- `Inventory`: 24 slots (a 6 x 4 grid) plus 5 hotbar slots that point at items in it. Stacking up to the max stack. Methods: Add (returns the leftover), Remove(id, n), Count(id), Move(slot, slot), Split, plus events or a version counter for UI refresh.
- `Crafting`: CanCraft(recipe, inventory), and Craft, which removes the inputs and adds the output and fails cleanly if there is no space.
- **Hotbar:** keys 1–5 select a slot. R uses the selected item: eat, drink or use a consumable; equip a tool. The equipped tool sets what F gathers.

## 4. World interaction (Game)

- **Look-at:** from the camera, the nearest interactable within 3 m of the player that is roughly in front of them. A prompt shows "[F] Gather Ferrite Rock" etc. Holding F fills a progress ring (gathering takes 1.2 s) and then yields 1–2 items.
- **`ResourceNode`** (NetworkBehaviour): item id, yield range, respawn time (5–10 min), required tool (none for rocks and scrap; `cutter` for plants). The host is authoritative: the gatherer sends a request to the server, the host checks and depletes the node, and tells the requester to add the items. Depleted nodes hide and respawn. Solo = host.
- **Nodes:** about 70 placed by a seeded scatter (`Mulberry32`) within 150 m of the outpost, outside building footprints and the pad. Kinds: ferrite rock, copper vein rock, silica sand patch, quartz cluster, ice chunk (in crater shadows), scrap pile and wiring (near the *Wren* and the outpost), fibre reeds, resin pods, lumen bulbs, sporeberry bushes, tuber mounds. For U3, use simple but readable stand-in meshes with distinct colours and silhouettes; U4 replaces them with Blender models.
- **Scanner:** hold V with the scanner equipped while looking at a node, a creature or a prop. It takes 1.5 s, unlocks a databank entry the first time (name, short description, which items it yields), and shows a scan card.
- **Pressurised zones:** trigger volumes with `PressurisedZone` in the *Wren* bay and inside the habs. They refill oxygen and count as shelter.
- **Fabricator:** an interactable in the *Wren* bay. F opens the PDA on the Fabricator tab.
- **Partner (co-op):** each player's health, oxygen and name are synced from the owner (owner-write NetworkVariables on the network player) so the HUD can show the partner.
- **Removed:** the drone combat. Delete `Core/Combat.cs` and `Tests/EditMode/CombatTests.cs`. Keep `Mission` (it becomes the first objective, restore outpost power, in U5).
- **The *Wren*:** replace the greybox *Wren* in `OutpostGreyboxBuilder` with `Art/Models/Props/SM_Wren.fbx` (URP materials remapped like `CharacterImport` does, mesh colliders, ramp walkable). The bay is the spawn, the fabricator and a pressurised zone.

## 5. Controls

WASD move, Shift sprint, Space dash, F interact or gather (hold), V scan (hold), R use the selected item, 1–5 hotbar, Tab PDA (opens and closes; the cursor is unlocked while it is open; player input is blocked), Esc closes the PDA. Camera: drag or Q/E to turn, scroll to zoom (as now). Gamepad: X gather, Y PDA, RB scan, LB use, d-pad hotbar.

## 6. UI: match the browser version's style

**Design tokens** (from `src/ui/style.css`; put them in one USS file `UI/Theme.uss`):
- **Ink:** `#e8eef6`; dim `#9aa8bb`.
- **Accents:** cyan `#6fe3ff`, amber `#ffae5c`, danger `#ff6b6b`, ok `#5cff9b`.
- **Glass panel:** a vertical gradient from `rgba(17,23,37,0.86)` to `rgba(8,11,19,0.9)`, with a faint cyan radial highlight at the top. Edge `1px rgba(140,200,255,0.2)`, radius 10–14 px, inner top highlight `rgba(255,255,255,0.07)`, dark drop shadow.
- **Fonts:** `UI/Fonts/Orbitron-Variable.ttf` for titles and labels (uppercase, letter-spacing 0.12–0.32 em, a soft warm glow on the big title). `UI/Fonts/Rajdhani-*.ttf` for body text (SemiBold 600 for values and buttons).
- **Buttons:** cyan-tinted glass (`rgba(111,227,255,0.18)` to `0.06`), border `rgba(111,227,255,0.45)`, 10 px radius, uppercase 0.12 em. Hover: brighter fill and a cyan border.
- **Motion:** panels fade and slide in (about 200 ms). A new objective pulses a cyan glow for 1.6 s (`objective-in`). Low vitals pulse danger red (`pulse` 1.2 s). Use USS transitions; fake glow with layered semi-transparent borders or a generated soft 9-slice texture. No backdrop blur.
- **Icons:** crisp vector glyphs drawn with UI Toolkit `Painter2D` (hexagon crystal for minerals, leaf for plants, drop for water, flame for food, bolt for power, gear for parts, tank for O2, cross for medical, wrench for tools, chip for electronics), tinted per category.

**HUD layout** (reference 1920x1080; scale with the screen):
- **Bottom-left:** vitals. Five compact rows: glyph, uppercase label, thin bar with a gradient fill, and a value. Oxygen is cyan; food amber; water blue `#5aa9ff`; temperature as a gradient from blue to white to red with a °C readout; health from the web's red-yellow-green gradient. Low values pulse.
- **Bottom-centre:** hotbar of 5 glass slots with icon, count and key number. The selected slot has a cyan border and glow.
- **Centre:** a small crosshair dot. Below it, the interaction prompt in the web `.prompt` style, with a thin hold-progress bar. The scan reticle is a ring that fills while V is held.
- **Top-left:** objective panel (web `.objective`; label "OBJECTIVE", 17 px text), with the room code and partner status small beneath it.
- **Top-centre:** compass strip with N/E/S/W ticks and markers (*Wren*, outpost).
- **Top-right:** toasts ("+2 FERRITE ORE", "DATABANK: LUMEN BULB"). They stack, fade in, and slide out after 3 s.
- **Death:** the screen fades to dark red-black with "SUIT FAILURE · RESPAWNING IN 8".

**PDA (Tab):**
- A centred glass panel about 1200x720. Header "PDA · KESTREL CREW" in Orbitron, with tabs INVENTORY · FABRICATOR · DATABANK · OBJECTIVES (MAP comes later). Subtle scanlines are optional and must stay subtle.
- **Inventory:** a 6 x 4 slot grid of item cards (glyph, name, count), and a detail pane with name, category, description and actions (Use, Assign to hotbar 1–5, Drop).
- **Fabricator:** recipe list grouped by category on the left. On the right, the detail: output, inputs with have/need counts (green if enough, red if short), a Craft button and a progress bar. Away from the station it reads "Requires fabricator" and the button is disabled.
- **Databank:** entries unlocked by scans, each with a title, category and description.
- **Objectives:** the current objective and a short log. U3's objective chain is a stub: "Find water", "Craft a cutter", "Restore the outpost power" (the last one is a placeholder).
- Restyle the existing lobby (`Scripts/Game/UI/LobbyUI.cs`) with the same theme: a big glowing Orbitron title "HOLLOW STAR", the subtitle "A CO-OP SURVIVAL STORY", and glass panel buttons.

## 7. Done when

- EditMode tests cover inventory stacking and moving, crafting, vitals decay and damage, and the clock. All pass.
- In play mode, solo, you can: gather rocks and plants, scan a node, open the PDA, craft a cutter at the fabricator, eat and drink from the hotbar, watch oxygen drain outdoors and refill in the bay, and die and respawn.
- In co-op (two app copies via Relay, as in U2): nodes deplete for both players, and each player sees the other's health and oxygen.
- A contact sheet of HUD and PDA screenshots matches the browser version's style.
