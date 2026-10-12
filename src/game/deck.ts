import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Vector3,
} from 'three';
import type { Bounds, Collider } from './collision';
import { buildMeridian } from './meridian';
import { mulberry32 } from './random';
import { deckTextures, emblemTexture, forceFieldTexture, hazardTexture } from './textures';

export const DECK = { halfX: 18, halfZ: 12 };
const HOLO_POS = new Vector3(0, 0, -3);

export interface Deck {
  group: Group;
  colliders: Collider[];
  bounds: Bounds;
  spawnPoints: Vector3[];
  update(time: number): void;
}

const CYAN = new Color(0.25, 1.6, 2.4);
const AMBER = new Color(2.6, 1.3, 0.35);

export function createDeck(anisotropy: number): Deck {
  const group = new Group();
  const colliders: Collider[] = [];
  const rand = mulberry32(1234);
  const { halfX, halfZ } = DECK;

  const metal = new MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.75, roughness: 0.42 });
  const darkMetal = new MeshStandardMaterial({ color: 0x1c1f25, metalness: 0.6, roughness: 0.55 });
  const trimCyan = new MeshBasicMaterial({ color: CYAN, toneMapped: false });
  const trimAmber = new MeshBasicMaterial({ color: AMBER, toneMapped: false });

  // Floor.
  const tex = deckTextures((halfX * 2) / 4, (halfZ * 2) / 4, anisotropy);
  const floorMat = new MeshStandardMaterial({
    map: tex.map,
    roughnessMap: tex.roughnessMap,
    bumpMap: tex.bumpMap,
    bumpScale: 1.4,
    metalness: 0.55,
    roughness: 1,
  });
  const floor = new Mesh(new BoxGeometry(halfX * 2, 1.2, halfZ * 2), [darkMetal, darkMetal, floorMat, darkMetal, darkMetal, darkMetal]);
  floor.position.y = -0.6;
  floor.receiveShadow = true;
  group.add(floor);

  // Underside structure gives the platform mass when seen from the side.
  const under = new Mesh(new BoxGeometry(halfX * 2 - 4, 3, halfZ * 2 - 4), darkMetal);
  under.position.y = -2.6;
  group.add(under);
  const keel = new Mesh(new CylinderGeometry(3.5, 1.2, 6, 8), darkMetal);
  keel.position.y = -6;
  group.add(keel);
  const thruster = new Mesh(new CylinderGeometry(1.1, 1.1, 0.2, 24), trimCyan);
  thruster.position.y = -9.05;
  group.add(thruster);

  // Glowing edge trim, just inside the railing.
  const trimGeoX = new BoxGeometry(halfX * 2 - 1, 0.05, 0.12);
  const trimGeoZ = new BoxGeometry(0.12, 0.05, halfZ * 2 - 1);
  for (const z of [-halfZ + 0.5, halfZ - 0.5]) {
    const m = new Mesh(trimGeoX, trimCyan);
    m.position.set(0, 0.02, z);
    group.add(m);
  }
  for (const x of [-halfX + 0.5, halfX - 0.5]) {
    const m = new Mesh(trimGeoZ, trimCyan);
    m.position.set(x, 0.02, 0);
    group.add(m);
  }

  // Railing posts (instanced) and rails, with a gap in the north edge for the gangway.
  const postPositions: Vector3[] = [];
  const gangwayHalf = 2.2;
  for (let x = -halfX + 0.3; x <= halfX - 0.3 + 1e-6; x += 2.0) {
    postPositions.push(new Vector3(x, 0.55, halfZ - 0.15));
    if (Math.abs(x) > gangwayHalf) postPositions.push(new Vector3(x, 0.55, -halfZ + 0.15));
  }
  for (let z = -halfZ + 2.3; z <= halfZ - 2.3 + 1e-6; z += 2.0) {
    postPositions.push(new Vector3(-halfX + 0.15, 0.55, z), new Vector3(halfX - 0.15, 0.55, z));
  }
  const posts = new InstancedMesh(new BoxGeometry(0.12, 1.1, 0.12), metal, postPositions.length);
  const m4 = new Matrix4();
  postPositions.forEach((p, i) => posts.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  posts.castShadow = true;
  group.add(posts);

  const railMat = metal;
  const addRail = (len: number, x: number, z: number, alongX: boolean) => {
    const rail = new Mesh(alongX ? new BoxGeometry(len, 0.08, 0.1) : new BoxGeometry(0.1, 0.08, len), railMat);
    rail.position.set(x, 1.1, z);
    rail.castShadow = true;
    group.add(rail);
  };
  addRail(halfX * 2 - 0.3, 0, halfZ - 0.15, true);
  const northLen = halfX - gangwayHalf;
  addRail(northLen, -(gangwayHalf + northLen / 2), -halfZ + 0.15, true);
  addRail(northLen, gangwayHalf + northLen / 2, -halfZ + 0.15, true);
  addRail(halfZ * 2 - 0.3, -halfX + 0.15, 0, false);
  addRail(halfZ * 2 - 0.3, halfX - 0.15, 0, false);

  // Gangway stub reaching toward the Meridian, with hazard paint.
  const gangway = new Mesh(new BoxGeometry(gangwayHalf * 2, 0.4, 8), darkMetal);
  gangway.position.set(0, -0.2, -halfZ - 4);
  gangway.receiveShadow = true;
  group.add(gangway);
  const hazard = new Mesh(
    new PlaneGeometry(gangwayHalf * 2, 0.6),
    new MeshStandardMaterial({ map: hazardTexture(4), roughness: 0.7, metalness: 0.2 }),
  );
  hazard.rotation.x = -Math.PI / 2;
  hazard.position.set(0, 0.011, -halfZ + 0.6);
  hazard.receiveShadow = true;
  group.add(hazard);
  for (const x of [-gangwayHalf + 0.15, gangwayHalf - 0.15]) {
    const lamp = new Mesh(new BoxGeometry(0.1, 0.06, 7.6), trimAmber);
    lamp.position.set(x, 0.03, -halfZ - 4);
    group.add(lamp);
  }
  // A force field holds the gangway closed for now.
  const field = new Mesh(
    new PlaneGeometry(gangwayHalf * 2, 2.6),
    new MeshBasicMaterial({
      color: new Color(0.25, 1.1, 1.8),
      alphaMap: forceFieldTexture(),
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  field.position.set(0, 1.3, -halfZ - 0.2);
  group.add(field);
  colliders.push({ kind: 'box', minX: -gangwayHalf, maxX: gangwayHalf, minZ: -halfZ - 1, maxZ: -halfZ + 0.1 });

  // Pillars with amber light strips.
  const pillarGeo = new BoxGeometry(1.4, 6, 1.4);
  const stripGeo = new BoxGeometry(0.08, 4.6, 0.06);
  for (const [x, z] of [
    [-14, -8],
    [14, -8],
    [-14, 8],
    [14, 8],
  ]) {
    const p = new Mesh(pillarGeo, metal);
    p.position.set(x, 3, z);
    p.castShadow = p.receiveShadow = true;
    group.add(p);
    const cap = new Mesh(new BoxGeometry(1.8, 0.4, 1.8), darkMetal);
    cap.position.set(x, 6.2, z);
    cap.castShadow = true;
    group.add(cap);
    for (const side of [-1, 1]) {
      const s = new Mesh(stripGeo, trimAmber);
      s.position.set(x + side * 0.4, 3, z + 0.72);
      group.add(s);
    }
    colliders.push({ kind: 'box', minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.7, maxZ: z + 0.7 });
  }
  const pillarLight = new PointLight(new Color(1, 0.6, 0.25), 18, 14, 2);
  pillarLight.position.set(-14, 4, 9.2);
  const pillarLight2 = pillarLight.clone();
  pillarLight2.position.set(14, 4, 9.2);
  group.add(pillarLight, pillarLight2);

  // Holotable with a slowly turning hologram of the Meridian.
  const holo = new Group();
  holo.position.copy(HOLO_POS);
  const base = new Mesh(new CylinderGeometry(1.5, 1.8, 0.9, 32), darkMetal);
  base.position.y = 0.45;
  base.castShadow = base.receiveShadow = true;
  const ring = new Mesh(new CylinderGeometry(1.52, 1.52, 0.06, 48, 1, true), trimCyan);
  ring.position.y = 0.88;
  const cone = new Mesh(
    new ConeGeometry(1.4, 2.4, 32, 1, true),
    new MeshBasicMaterial({ color: new Color(0.15, 0.6, 0.9), transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  cone.position.y = 2.1;
  cone.rotation.x = Math.PI;
  const holoMat = new MeshBasicMaterial({ color: new Color(0.3, 1.4, 2.2), wireframe: true, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
  const hologram = buildMeridian(holoMat);
  hologram.scale.setScalar(0.85);
  hologram.position.y = 2.3;
  hologram.rotation.z = 0.15;
  const holoLight = new PointLight(new Color(0.4, 0.85, 1), 22, 10, 2);
  holoLight.position.y = 2.2;
  holo.add(base, ring, cone, hologram, holoLight);
  group.add(holo);
  colliders.push({ kind: 'circle', x: HOLO_POS.x, z: HOLO_POS.z, r: 1.8 });

  const emblem = new Mesh(
    new PlaneGeometry(9, 9),
    new MeshStandardMaterial({ map: emblemTexture(), transparent: true, roughness: 0.6, metalness: 0.1, depthWrite: false }),
  );
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.set(HOLO_POS.x, 0.012, HOLO_POS.z);
  emblem.receiveShadow = true;
  group.add(emblem);

  // Cargo crates in loose clusters (instanced).
  const crateSpots: [number, number, number][] = [];
  for (const [cx, cz, n] of [
    [-11, 6, 4],
    [11, -5, 3],
    [8, 9, 2],
    [-10, -8, 3],
  ]) {
    for (let i = 0; i < n; i++) crateSpots.push([cx + (i % 2) * 1.35 + (rand() - 0.5) * 0.2, cz + Math.floor(i / 2) * 1.35 + (rand() - 0.5) * 0.2, rand() * 0.3 - 0.15]);
  }
  const crateMat = new MeshStandardMaterial({ color: 0x4d4436, metalness: 0.35, roughness: 0.65 });
  const crates = new InstancedMesh(new BoxGeometry(1.2, 1.2, 1.2), crateMat, crateSpots.length + 2);
  const dummy = new Object3D();
  crateSpots.forEach(([x, z, ry], i) => {
    dummy.position.set(x, 0.6, z);
    dummy.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), ry);
    dummy.updateMatrix();
    crates.setMatrixAt(i, dummy.matrix);
    colliders.push({ kind: 'circle', x, z, r: 0.85 });
  });
  // Two stacked on top.
  [crateSpots[0], crateSpots[4]].forEach(([x, z], k) => {
    dummy.position.set(x + 0.1, 1.8, z + 0.05);
    dummy.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4));
    dummy.updateMatrix();
    crates.setMatrixAt(crateSpots.length + k, dummy.matrix);
  });
  crates.castShadow = crates.receiveShadow = true;
  group.add(crates);

  // The derelict Meridian itself, far out, with blinking beacons.
  const hullMat = new MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.5, fog: false });
  const detailMat = new MeshStandardMaterial({ color: 0x3a342c, metalness: 0.5, roughness: 0.6, fog: false });
  const meridian = buildMeridian(hullMat, detailMat);
  meridian.scale.setScalar(110);
  meridian.position.set(-240, -120, -420);
  meridian.rotation.set(0.1, 0.9, -0.12);
  const beaconMat = new MeshBasicMaterial({ color: new Color(6, 0.4, 0.3), fog: false, toneMapped: false });
  const beacons: Mesh[] = [];
  for (const [x, y, z] of [
    [1.35, 0.15, 0],
    [-1.4, 0.2, 0],
    [0.45, 0.55, 0],
  ]) {
    const b = new Mesh(new BoxGeometry(0.02, 0.02, 0.02), beaconMat);
    b.position.set(x, y, z);
    meridian.add(b);
    beacons.push(b);
  }
  group.add(meridian);

  const spawnPoints = [new Vector3(-2.5, 0, 4), new Vector3(2.5, 0, 4)];

  return {
    group,
    colliders,
    bounds: { minX: -halfX + 0.4, maxX: halfX - 0.4, minZ: -halfZ + 0.4, maxZ: halfZ - 0.4 },
    spawnPoints,
    update(time) {
      hologram.rotation.y = time * 0.25;
      holoMat.opacity = 0.45 + Math.sin(time * 3.1) * 0.06 + (Math.sin(time * 17.0) > 0.97 ? 0.25 : 0);
      field.material.opacity = 0.42 + Math.sin(time * 2.0) * 0.08;
      beacons.forEach((b, i) => (b.visible = Math.sin(time * 2.2 + i * 2.1) > 0.6));
    },
  };
}
