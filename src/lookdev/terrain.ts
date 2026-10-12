// Look-dev for the moon terrain: ground, rocks, far mountains.
//   node scripts/lookdev.mjs terrain player ground vista aerial outcrop
import { CapsuleGeometry, Mesh, MeshStandardMaterial, type InstancedMesh } from 'three';
import { WRECK } from '../env/layout';
import { createTerrain, setTerrainAnisotropy, setTerrainDebug, type TerrainWithStats } from '../env/terrain';
import { runLookdev, type LookdevView } from './harness';

let terrain: TerrainWithStats | null = null;

// Heights get filled in from the terrain once it exists (y values below are offsets above ground).
const views: Record<string, LookdevView> = {
  player: { position: [0, 12, 22], target: [0, 0, 2], fov: 38 },
  ground: { position: [-34, 1.7, 66], target: [10, 0.6, 18], fov: 50 },
  vista: { position: [0, 6, 30], target: [WRECK.x, 0, WRECK.z], fov: 45 },
  aerial: { position: [480, 560, 640], target: [-160, 0, -760], fov: 50 },
  outcrop: { position: [52, 2.2, -30], target: [76, 0.8, -58], fov: 50 },
  far: { position: [0, 30, 0], target: [-500, 60, -1500], fov: 50 },
  sunward: { position: [10, 6, 10], target: [-870, 40, -492], fov: 55 },
  map: { position: [0, 700, -100], target: [0, 0, -100.01], fov: 45 },
  closeup: { position: [-31, 1.7, 63], target: [-29, 0, 59], fov: 50 },
};
/** Views whose y values are relative to the ground under the camera / target. */
const relative = new Set(['ground', 'outcrop', 'closeup']);

void runLookdev({
  shadowExtent: 120,
  views,
  setup({ scene, gl, camera, params }) {
    camera.near = 0.15;
    camera.far = 20000;
    terrain = createTerrain({ gl, quality: (params.get('q') as 'low' | 'medium' | 'high') ?? 'high' });
    scene.add(terrain.group);
    setTerrainDebug(Number(params.get('dbg') ?? 0));
    // Software rendering (SwiftShader) pays per anisotropic tap; 4x keeps shots inside the
    // screenshot timeout. The game itself uses 8x on 'high'. Override with ?aniso=N.
    setTerrainAnisotropy(gl, terrain.textures, Number(params.get('aniso') ?? 4));
    for (const name of relative) {
      const v = views[name];
      v.position[1] += terrain.heightAt(v.position[0], v.position[2]);
      v.target[1] += terrain.heightAt(v.target[0], v.target[2]);
    }
    // Scale references: a 1.8 m crew member at the spawn and in the ground view.
    const crewMat = new MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.6 });
    for (const [x, z] of [
      [4.5, 16],
      [-22, 52],
      [62, -40],
    ]) {
      const m = new Mesh(new CapsuleGeometry(0.3, 1.2, 4, 12), crewMat);
      m.position.set(x, terrain.heightAt(x, z) + 0.9, z);
      m.castShadow = true;
      scene.add(m);
    }
  },
  update(time, { camera, gl, params }) {
    if (!terrain) return;
    terrain.update(time, camera);
    // Frame 0 renders without the terrain so we can report the terrain's own cost.
    if (frame === 0) terrain.group.visible = false;
    if (frame === 1) {
      const { calls, triangles } = gl.info.render;
      console.info(`[lookdev] baseline (no terrain) draws=${calls} triangles=${triangles}; terrain ${terrain.stats.breakdown}`);
      terrain.group.visible = true;
      if (params.has('debug')) {
        const rows: string[] = [];
        terrain.group.traverse((o) => {
          const m = o as InstancedMesh;
          if (!m.isMesh || !m.visible) return;
          const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
          const n = m.isInstancedMesh ? m.count : 1;
          rows.push(`${m.name}:${n}x${tris}=${Math.round((n * tris) / 1000)}k${m.castShadow ? '*' : ''}`);
        });
        console.info(`[lookdev] meshes ${rows.join(' ')}`);
      }
    }
    frame++;
  },
});
let frame = 0;
