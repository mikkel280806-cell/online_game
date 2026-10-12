import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';

/**
 * The colony ship Meridian, built at unit scale along the X axis (bow at +X).
 * One habitation ring is broken: something tore it open.
 * The same parts are used for the far-off derelict and the holotable hologram.
 */
export function buildMeridian(hull: Material, detail: Material = hull): Group {
  const ship = new Group();
  const add = (geo: BufferGeometry, mat: Material, x: number, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    ship.add(m);
    return m;
  };
  const half = Math.PI / 2;

  // Spine and bow.
  add(new CylinderGeometry(0.06, 0.06, 2.6, 12), hull, 0, 0, 0, 0, 0, half);
  add(new SphereGeometry(0.2, 20, 12), hull, 1.32, 0, 0);
  add(new CylinderGeometry(0.1, 0.2, 0.3, 16), hull, 1.1, 0, 0, 0, 0, half);

  // Habitation rings: the forward one intact, the aft one broken.
  add(new TorusGeometry(0.52, 0.05, 10, 64), hull, 0.45, 0, 0, 0, half, 0);
  add(new TorusGeometry(0.52, 0.05, 10, 64, Math.PI * 1.45), hull, -0.15, 0, 0, 0, half, 0.6);
  for (const x of [0.45, -0.15]) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      if (x < 0 && i === 2) continue; // the snapped spoke
      add(new BoxGeometry(0.03, 0.5, 0.03), detail, x, Math.cos(a) * 0.26, Math.sin(a) * 0.26, a, 0, 0);
    }
  }

  // Cargo pods along the spine.
  for (let i = 0; i < 6; i++) {
    const x = 0.95 - i * 0.18;
    if (x > 0.35 && x < 0.55) continue;
    add(new BoxGeometry(0.12, 0.1, 0.1), detail, x, 0.11, 0);
    add(new BoxGeometry(0.12, 0.1, 0.1), detail, x, -0.11, 0);
  }

  // Engine block and bells.
  add(new BoxGeometry(0.45, 0.32, 0.32), hull, -1.15, 0, 0);
  for (const [y, z] of [
    [0.09, 0.09],
    [-0.09, 0.09],
    [0.09, -0.09],
    [-0.09, -0.09],
  ]) {
    add(new ConeGeometry(0.08, 0.22, 16, 1, true), detail, -1.45, y, z, 0, 0, -half);
  }
  return ship;
}
