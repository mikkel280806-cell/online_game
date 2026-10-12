# Art Bible — Hollow Star, Chapter 1: "Vigil"

Target: grounded, realistic sci-fi in the spirit of *Interstellar*, *Alien* (1979), *The Expanse* and *Star Citizen* planetside. **Nothing floats. Everything is heavy, worn, and sits in the dust.**

## The place

- **Vigil**: a small airless-ish moon (thin haze) orbiting the gas giant **Orrin**.
- The dying red giant **the Hollow** hangs low on the horizon forever. It is a huge, dim orange-red disc that casts long, warm shadows.
- **Survey Outpost Kestrel-7** is a small, abandoned research station. The players' dropship, the *Wren*, stands on its landing pad.
- Kilometres away to the north lies the **Meridian**: the lost colony ship, crashed and half-buried, with a long ploughed trench behind it and debris everywhere.

## Lighting (owned by the renderer; build materials to respond to it)

| Source | Direction | Colour | Notes |
|---|---|---|---|
| The Hollow (key) | `SUN_DIR` in `src/env/layout.ts`, ~11° above the horizon, from the west-north-west | warm orange-red, `#ffb27a` | Long shadows. Cascaded shadow maps. |
| Sky fill | above | cool blue-violet, low | Keeps shadows readable, never black. |
| Orrin bounce | `PLANET_DIR`, east | dusty amber, low | Subtle warm fill from the opposite side. |
| Practical lights | outpost floodlights, beacons, windows | cool white `#d8e8ff`, warm white `#ffd9a8`, beacon red | HDR emissive 2–8, so bloom catches them. |

Atmosphere: height fog with sun-coloured in-scattering. Distant mountains fade toward the horizon colour. Fog is global; don't add your own.

## Materials — realism rules

1. **PBR only** (`MeshStandardMaterial`, or `MeshPhysicalMaterial` for glass and visors). Linear workflow.
2. **Albedo range:** no pure black or white. Base colours between sRGB ~#151515 and ~#d0d0d0. Regolith is about #7d7368, basalt about #3f3a36.
3. **Every surface has micro-detail:** a normal map plus roughness variation. Nothing seen within 10 m may be a flat untextured primitive. Use `bakeTexture()` (`src/env/bake.ts`) with the GLSL noise library (`src/env/shaders/noise.ts`) to make tileable textures on the GPU.
4. **Bevel every hard edge:** use `RoundedBoxGeometry` (radius 1–3% of size) or chamfers. Sharp CG edges read as fake. Bevels catch the low sun.
5. **Weathering:**
   - Grime gathers low on objects and in crevices.
   - Paint chips at edges.
   - **Dust settles on up-facing surfaces:** blend toward `DUST_COLOR` where world normal.y > ~0.7, broken up with noise. This ties props into the ground and is the single biggest realism trick.
6. **Ground contact:** objects sink slightly into the regolith, and big objects have skirts of piled dust or rocks at their base. Ambient occlusion (N8AO in post) helps, but contact shapes sell weight.
7. **Scale anchors:** a crew member is 1.8 m, a doorway 2.1 m, a cargo container 6 × 2.4 × 2.6 m, the dropship about 22 m long, and the Meridian about 420 m long.

## Palette

| Use | Colour |
|---|---|
| Regolith / dust | `#7d7368` (`DUST_COLOR`) |
| Rock (basalt) | `#3f3a36`, lighter strata `#5a524b` |
| Frost in shadowed hollows | `#b9c4cc` (sparingly) |
| Outpost paint | off-white `#c9c6bd`, gunmetal `#2b2e33`, hazard yellow `#d1a21f` |
| Vanguard accent | signal orange `#ff7a1a` |
| Tether accent | teal `#29d3ff` |
| Emissive | warm `#ffd9a8`, cool `#cfe6ff`, beacon red `#ff2a1a` |

## Performance budget (MacBook Air M4, 60 fps target)

- Triangles on screen: < 2.5 M. Draw calls: < 400 (use `InstancedMesh` and merged geometry).
- Shadow casters: only things larger than ~0.3 m.
- Textures: bake at 512–2048 px; reuse them.
- Real lights: at most ~6 point/spot lights in total, and only the key light casts shadows. Fake the rest with emissive surfaces and additive light-cone meshes.

## Shared code you can use

- `src/env/layout.ts`: world layout constants and lighting directions.
- `src/env/bake.ts`: `bakeTexture(gl, { size, fragment })` renders a GLSL function to a tileable texture.
- `src/env/shaders/noise.ts`: GLSL hash, value/gradient noise, fbm and voronoi, including periodic (tileable) versions.
- `src/lookdev/harness.ts` + `scripts/lookdev.mjs`: render your module in headless Chromium and look at it. **Look at your work and iterate.**
