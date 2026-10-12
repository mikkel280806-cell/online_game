// Look-dev for the Chapter 1 props: outpost, landing pad, the Wren and the Meridian wreck.
import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { DUST_COLOR } from '../env/layout';
import { createProps, propsStats } from '../env/props';
import type { Props } from '../env/types';
import { runLookdev } from './harness';

let props: Props | null = null;
const syncPixel = new Uint8Array(4);

void runLookdev({
  ground: true,
  shadowExtent: 60,
  views: {
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
  },
  setup({ scene, gl, params, sun }) {
    // 4096² shadows are too slow for SwiftShader with this much geometry; 2048 is plenty here.
    sun.shadow.mapSize.set(2048, 2048);
    const quality = (params.get('quality') as 'low' | 'medium' | 'high' | null) ?? 'high';
    props = createProps({ gl, quality }, () => 0);
    // The harness ground is 400 m wide; extend it so the distant wreck sits on something.
    const far = new Mesh(new PlaneGeometry(4000, 4000), new MeshStandardMaterial({ color: DUST_COLOR, roughness: 0.95 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.03;
    far.receiveShadow = true;
    scene.add(far);
    scene.add(props.group);
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
