// Look-dev for the Chapter 1 props: outpost, landing pad, the Wren and the Meridian wreck.
//
// Extra URL params:
//   ?leak=1      leak check: back faces render bright magenta and the sky/ground bright green, so
//                any slit, open end or missing face (anything you can see *into* or *through*)
//                lights up. Use with the close-up views below.
//   ?hide=a,b    hide meshes by name prefix ('points' = glow sprites, 'cones' = light cones).
//   ?colliders=1 draw the gameplay colliders as translucent red columns (1.9 m tall).
//   ?t=seconds   animation time (default 2.5), e.g. to film the lights over a few frames.
import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type Object3D } from 'three';
import { DUST_COLOR, LANDING_PAD } from '../env/layout';
import { createProps, propsStats } from '../env/props';
import { FLOODLIGHTS, MAST, SHIP, shipToWorld, TANKS, WREN } from '../env/props/layout';
import { propsDebug } from '../env/props/materials';
import type { Props } from '../env/types';
import { runLookdev, type LookdevView } from './harness';

let props: Props | null = null;
const syncPixel = new Uint8Array(4);

/** View in ship space (x, y, z with nose -Z, ramp +Z) → world. */
function shipView(from: [number, number, number], to: [number, number, number], fov = 45): LookdevView {
  const a = shipToWorld(from[0], from[2]);
  const b = shipToWorld(to[0], to[2]);
  return { position: [a.x, from[1] + SHIP.y, a.z], target: [b.x, to[1] + SHIP.y, b.z], fov };
}

const flood = FLOODLIGHTS[2];
const tank = TANKS[0];

const views: Record<string, LookdevView> = {
  outpost: { position: [0, 14, 26], target: [0, 0, 4] },
  ship: { position: [27, 1.5, -6.5], target: [13.5, 3.0, 1.5], fov: 42 },
  ship2: { position: [1.5, 1.5, -11], target: [14, 3.0, 1.0], fov: 42 },
  ramp: { position: [6, 1.7, 17.6], target: [11.6, 2.0, 6.5], fov: 55 },
  hab: { position: [-4.2, 1.8, 7.4], target: [-9.4, 1.9, 3.6], fov: 50 },
  wreck: { position: [0, 8, 20], target: [-70, 26, -560], fov: 25 },
  pad: { position: [-4, 22, 30], target: [11, 0, 5], fov: 45 },
  rear: { position: [30, 6, 26], target: [12, 2.5, 3], fov: 45 },
  yard: { position: [-4, 6, -32], target: [-18, 3, -8], fov: 55 },
  tanks: { position: [12, 3, -26], target: [24, 2, -14], fov: 50 },

  // ---- close-ups for the gap / leak audit ----------------------------------------------------
  // Cargo containers: door end, 3/4 gameplay angle, blind end, grazing along the side, top.
  ctDoor: { position: [-0.6, 2.2, 25.5], target: [-4.6, 2.2, 23.0], fov: 50 },
  ctDoorClose: { position: [-2.6, 1.5, 25.4], target: [-4.0, 1.4, 24.5], fov: 30 },
  ct34: { position: [4, 9, 34], target: [-7, 2.4, 23], fov: 45 },
  ctBlind: { position: [-15.5, 3.2, 27.5], target: [-9.5, 2.4, 23], fov: 50 },
  ctGraze: { position: [0.5, 1.4, 19.6], target: [-12, 1.8, 20.6], fov: 40 },
  ctTop: { position: [-3, 11, 29], target: [-7.2, 3.5, 23], fov: 45 },
  ctLone: { position: [12.5, 2.4, -31], target: [8.5, 1.4, -26], fov: 50 },
  // Habitat modules, tunnels and their junctions.
  habN: { position: [-7.5, 2.6, -3.5], target: [-13, 2.6, 0.6], fov: 50 },
  habLab: { position: [-8.5, 3.0, -6.5], target: [-13, 2.4, -9.0], fov: 50 },
  hab3: { position: [-19.5, 3.4, 8.5], target: [-23.2, 2.6, 3.6], fov: 50 },
  habW: { position: [-21, 5, 14], target: [-14.5, 2.6, 4], fov: 50 },
  hab34: { position: [0, 11, 18], target: [-14, 2.2, 3], fov: 45 },
  habLock: { position: [-6.5, 2.0, 1.5], target: [-10.5, 2.0, 3.8], fov: 50 },
  // Fuel tanks.
  tank: { position: [tank.x - 6, 2.2, tank.z + 5.5], target: [tank.x, 1.5, tank.z - 1.5], fov: 50 },
  tankEnd: { position: [tank.x + 8, 2.0, tank.z + 2.5], target: [tank.x + 2, 1.6, tank.z - 1.6], fov: 50 },
  // The Wren: nose, tail, fins, nacelle intakes and nozzles, gear, cargo bay.
  wNose: shipView([1.2, 2.6, -15.5], [0, 2.1, -10.4], 45),
  wTail: shipView([2.5, 5.2, 15.5], [0, 3.7, 9.6], 45),
  wFin: shipView([4.5, 7.5, 12.5], [0.8, 4.6, 8.4], 45),
  wIntake: shipView([WREN.nacelleX + 1.5, 3.2, -3.6], [WREN.nacelleX, WREN.nacelleY, WREN.nacelleZ0 + 0.4], 45),
  wNozzle: shipView([WREN.nacelleX + 1.8, 3.1, 14.2], [WREN.nacelleX, WREN.nacelleY, WREN.nacelleZ1], 45),
  wNoseGear: shipView([2.6, 1.0, -10.6], [0, 1.25, -7.3], 50),
  wMainGear: shipView([7.6, 1.3, 1.0], [WREN.nacelleX, 1.5, WREN.mainGearZ], 50),
  wBay: shipView([0.3, 2.3, 14.5], [0, 2.7, 4.0], 55),
  wPylon: shipView([8.5, 0.9, 6.5], [2.6, 2.6, 4.0], 50),
  wTop: shipView([7, 9.5, -1], [0, 4.2, 3], 45),
  // Floodlights (the deliberately broken one in the yard, and a working one), comms mast.
  flood: { position: [flood.x + 4.5, flood.height - 0.6, flood.z + 5], target: [flood.x, flood.height - 0.3, flood.z], fov: 45 },
  floodTop: { position: [flood.x - 1.5, flood.height + 3.2, flood.z + 3.2], target: [flood.x, flood.height, flood.z], fov: 45 },
  floodFront: { position: [flood.x + 3.6, flood.height - 1.2, flood.z + 2.2], target: [flood.x + 0.3, flood.height - 0.25, flood.z + 0.1], fov: 40 },
  floodHead: { position: [flood.x + 1.2, flood.height + 1.6, flood.z - 2.6], target: [flood.x + 0.3, flood.height - 0.2, flood.z], fov: 40 },
  // Gameplay-height view of the yard floodlight with the wreck's broken ring behind it.
  floodWreck: { position: [flood.x + 2.2, 3.4, flood.z + 18.5], target: [flood.x - 0.3, flood.height - 0.5, flood.z], fov: 40 },
  flood1: { position: [FLOODLIGHTS[0].x - 3.5, FLOODLIGHTS[0].height + 1.0, FLOODLIGHTS[0].z + 3.5], target: [FLOODLIGHTS[0].x, FLOODLIGHTS[0].height - 0.3, FLOODLIGHTS[0].z], fov: 45 },
  mast: { position: [MAST.x + 7, 3.5, MAST.z + 7], target: [MAST.x, 2.0, MAST.z], fov: 50 },
  mastTop: { position: [MAST.x + 5, MAST.height + 1, MAST.z + 6], target: [MAST.x - 1, MAST.height - 3, MAST.z + 1.5], fov: 50 },
  // Small stuff: rover, crates, sign, solar array, pad edge.
  rover: { position: [3, 3.0, 15], target: [-3.6, 1.5, 10.8], fov: 50 },
  crates: { position: [1, 2.2, 25.5], target: [-2.6, 0.6, 22], fov: 50 },
  solar: { position: [-15, 3, -21], target: [-23.5, 1.4, -25], fov: 50 },
  padEdge: { position: [LANDING_PAD.x - 17, 1.4, LANDING_PAD.z + 2], target: [LANDING_PAD.x - 12, 0.1, LANDING_PAD.z], fov: 50 },
};

const urlTime = Number(new URLSearchParams(location.search).get('t') ?? '');

void runLookdev({
  ground: true,
  shadowExtent: 60,
  // ?t=seconds renders the animated lights (beacons, failing lamps) at that time.
  time: Number.isFinite(urlTime) && urlTime > 0 ? urlTime : undefined,
  views,
  setup({ scene, gl, params, sun }) {
    // 4096² shadows are too slow for SwiftShader with this much geometry; 2048 is plenty here.
    sun.shadow.mapSize.set(2048, 2048);
    const quality = (params.get('quality') as 'low' | 'medium' | 'high' | null) ?? 'high';
    const leak = params.get('leak') === '1';
    propsDebug.leak = leak;
    props = createProps({ gl, quality }, () => 0);
    // The harness ground is 400 m wide; extend it so the distant wreck sits on something.
    const far = new Mesh(new PlaneGeometry(4000, 4000), new MeshStandardMaterial({ color: DUST_COLOR, roughness: 0.95 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.03;
    far.receiveShadow = true;
    scene.add(far);
    scene.add(props.group);
    if (leak) {
      // Everything that is not a prop turns bright green (seen *through* a gap); back faces of
      // props are magenta (seen *into* an object).
      const green = new MeshBasicMaterial({ color: '#00ff40' });
      scene.traverse((o: Object3D) => {
        if (o instanceof Mesh && !isProp(o)) o.material = green;
      });
      scene.environment = null;
    }
    if (params.get('colliders') === '1') {
      const mat = new MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.35, depthWrite: false });
      for (const c of props.colliders) {
        const m =
          c.kind === 'circle'
            ? new Mesh(new CylinderGeometry(c.r, c.r, 1.9, 24), mat)
            : new Mesh(new BoxGeometry(c.maxX - c.minX, 1.9, c.maxZ - c.minZ), mat);
        if (c.kind === 'circle') m.position.set(c.x, 0.95, c.z);
        else m.position.set((c.minX + c.maxX) / 2, 0.95, (c.minZ + c.maxZ) / 2);
        scene.add(m);
      }
    }
    // Debug: ?hide=name1,name2 hides meshes/lights by name prefix.
    const hide = (params.get('hide') ?? '').split(',').filter(Boolean);
    props.group.traverse((o) => {
      if (hide.some((h) => o.name.startsWith(h) || (h === 'points' && o.type === 'Points') || (h === 'cones' && o.renderOrder === 9))) o.visible = false;
    });
    console.info(`[lookdev] props createProps=${propsStats.ms.toFixed(0)}ms meshes=${propsStats.meshes} triangles=${propsStats.triangles} stages=${JSON.stringify(propsStats.stages)}`);
  },
  update(time, { gl }) {
    props?.update(time);
    // Look-dev only: wait for the previous frame on the (software) GPU so queued work never
    // piles up past the screenshot timeout when other renders share the CPU.
    const c = gl.getContext();
    c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, syncPixel); // forces the GPU to catch up
  },
});

function isProp(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p === props?.group) return true;
  return false;
}

