// Playable crew member: an articulated EVA suit with procedural animation.
//
// Rendering: one SkinnedMesh for the whole suit (a single uber-material, see materials.ts)
// plus the gold visor, so a character costs 2 draw calls (+ shadow passes).
// Animation: see locomotion.ts. The bones are plain Object3D (THREE.Bone) children of `root`.

import { Group, Mesh, Skeleton, SkinnedMesh, Sphere, SpotLight, Vector3, type BufferGeometry, type WebGLRenderer } from 'three';
import type { RoleId } from '../game/roles';
import { Locomotion, type FootState } from './locomotion';
import { createSuitMaterial, prewarmSuitTextures, visorMaterial, type SuitMaterial } from './materials';
import { createBones, type Bones } from './rig';
import { buildSuit } from './suit';

const cache = new Map<RoleId, { body: BufferGeometry; visor: BufferGeometry; triangles: number }>();

function suitFor(role: RoleId) {
  let s = cache.get(role);
  if (!s) {
    s = buildSuit(role);
    cache.set(role, s);
  }
  return s;
}

/** Visual model of a crew member in an EVA suit. Animation is driven by `speed`. */
export class Avatar {
  readonly root = new Group();
  readonly bones: Bones;
  readonly skeleton: Skeleton;
  readonly mesh: SkinnedMesh;
  readonly visor: Mesh;
  /** Triangles in this character (suit + visor). */
  readonly triangles: number;
  private readonly loco: Locomotion;
  private readonly material: SuitMaterial;
  private headlamp: SpotLight | null = null;

  constructor(readonly role: RoleId) {
    this.root.name = `avatar-${role}`;
    const { bones, list } = createBones();
    this.bones = bones;
    const suit = suitFor(role);
    this.triangles = suit.triangles;

    this.material = createSuitMaterial();
    this.mesh = new SkinnedMesh(suit.body, this.material);
    this.mesh.name = 'suit';
    this.root.add(bones.pelvis, this.mesh);
    this.root.updateMatrixWorld(true);
    this.skeleton = new Skeleton(list);
    this.mesh.bind(this.skeleton);
    // Generous fixed bounds (posed limbs never leave this sphere), so culling never needs a skinning pass.
    this.mesh.boundingSphere = new Sphere(new Vector3(0, 0.95, 0), 1.4);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.visor = new Mesh(suit.visor, visorMaterial());
    this.visor.name = 'visor';
    this.visor.castShadow = true;
    this.visor.receiveShadow = true;
    bones.head.add(this.visor);

    this.loco = new Locomotion(role === 'vanguard' ? 0x51a7e : 0x7e74e);
    this.loco.update(0, 0, 0, bones);
  }

  /** Set pose for this frame. `position.y` is the ground height; yaw 0 faces +Z; speed in m/s. */
  animate(position: Vector3, yaw: number, speed: number, dt: number): void {
    if (Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) this.root.position.copy(position);
    if (Number.isFinite(yaw)) this.root.rotation.y = yaw;
    this.loco.update(yaw, speed, dt, this.bones);
  }

  /** Glance at the wrist computer (idle only; it also happens on its own now and then). */
  lookAtWrist(): void {
    this.loco.triggerGesture();
  }

  /** Ground anchors of the feet (root space) and whether each is planted: for footstep effects. */
  get feet(): readonly FootState[] {
    return this.loco.feet;
  }

  /**
   * Helmet lamps. Off: the lenses still glow faintly. On: they glow brightly and a real
   * (unshadowed) spot light is added on the helmet — mind the scene's light budget.
   */
  setHeadlamp(on: boolean): void {
    this.material.userData.emitGain.value.g = on ? 1.6 : 1;
    if (on && !this.headlamp) {
      const l = new SpotLight(0xdbe9ff, 14, 22, 0.42, 0.55, 1.6);
      l.position.set(0, 0.14, 0.12);
      l.target.position.set(0, -0.6, 6);
      this.bones.head.add(l, l.target);
      this.headlamp = l;
    }
    if (this.headlamp) this.headlamp.visible = on;
  }

  /** Bake the shared suit textures now instead of on first render (avoids a first-frame hitch). */
  static prewarm(gl: WebGLRenderer): void {
    prewarmSuitTextures(gl);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.material.dispose();
    this.skeleton.dispose();
    this.headlamp?.dispose();
  }
}
