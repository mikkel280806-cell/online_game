import { Mesh, MeshStandardMaterial, PlaneGeometry, type Vector3 } from 'three';
import { DUST_COLOR } from '../layout';
import type { EnvContext, Terrain } from '../types';

// PLACEHOLDER: the Terrain agent replaces this with the moon surface. Keep the contract in ../types.ts.
export function createTerrain(_ctx: EnvContext): Terrain {
  const ground = new Mesh(new PlaneGeometry(2000, 2000), new MeshStandardMaterial({ color: DUST_COLOR, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return {
    group: ground,
    heightAt: () => 0,
    normalAt: (_x: number, _z: number, out: Vector3) => out.set(0, 1, 0),
    colliders: [],
    update() {},
  };
}
