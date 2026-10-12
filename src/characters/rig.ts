// Joint hierarchy of the EVA suit. Bind pose: standing straight, arms hanging down, all bones
// unrotated, so every bone's local axes match the mesh axes (+Y up, +Z forward, +X = left).

import { Bone, Vector3 } from 'three';

export const BONE = {
  pelvis: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  clavL: 5,
  armL: 6,
  foreL: 7,
  handL: 8,
  clavR: 9,
  armR: 10,
  foreR: 11,
  handR: 12,
  thighL: 13,
  shinL: 14,
  footL: 15,
  thighR: 16,
  shinR: 17,
  footR: 18,
  pack: 19,
  antenna: 20,
} as const;
export type BoneId = (typeof BONE)[keyof typeof BONE];

/** Key dimensions (metres). The suited crew member is 1.8 m to the top of the helmet. */
export const DIM = {
  height: 1.8,
  hipY: 0.95,
  hipX: 0.105,
  thigh: 0.43,
  shin: 0.42,
  ankleY: 0.1,
  /** Heel and ball of the foot relative to the ankle, in the foot's frame (ground at y = -ankleY). */
  heelZ: -0.085,
  ballZ: 0.135,
  toeZ: 0.205,
  shoulderX: 0.235,
  shoulderY: 1.425,
  upperArm: 0.29,
  forearm: 0.26,
};

/** Bind-pose joint positions in mesh space. */
export const JOINTS: Record<keyof typeof BONE, Vector3> = {
  pelvis: new Vector3(0, 0.98, 0),
  spine: new Vector3(0, 1.08, -0.01),
  chest: new Vector3(0, 1.24, -0.012),
  neck: new Vector3(0, 1.5, -0.005),
  head: new Vector3(0, 1.535, 0),
  clavL: new Vector3(0.06, 1.42, -0.012),
  armL: new Vector3(DIM.shoulderX, DIM.shoulderY, -0.012),
  foreL: new Vector3(DIM.shoulderX, DIM.shoulderY - DIM.upperArm, -0.012),
  handL: new Vector3(DIM.shoulderX, DIM.shoulderY - DIM.upperArm - DIM.forearm, -0.008),
  clavR: new Vector3(-0.06, 1.42, -0.012),
  armR: new Vector3(-DIM.shoulderX, DIM.shoulderY, -0.012),
  foreR: new Vector3(-DIM.shoulderX, DIM.shoulderY - DIM.upperArm, -0.012),
  handR: new Vector3(-DIM.shoulderX, DIM.shoulderY - DIM.upperArm - DIM.forearm, -0.008),
  thighL: new Vector3(DIM.hipX, DIM.hipY, 0),
  shinL: new Vector3(DIM.hipX, DIM.hipY - DIM.thigh, 0),
  footL: new Vector3(DIM.hipX, DIM.ankleY, 0),
  thighR: new Vector3(-DIM.hipX, DIM.hipY, 0),
  shinR: new Vector3(-DIM.hipX, DIM.hipY - DIM.thigh, 0),
  footR: new Vector3(-DIM.hipX, DIM.ankleY, 0),
  pack: new Vector3(0, 1.26, -0.17),
  antenna: new Vector3(-0.15, 1.53, -0.3),
};

const PARENT: Record<keyof typeof BONE, keyof typeof BONE | null> = {
  pelvis: null,
  spine: 'pelvis',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  clavL: 'chest',
  armL: 'clavL',
  foreL: 'armL',
  handL: 'foreL',
  clavR: 'chest',
  armR: 'clavR',
  foreR: 'armR',
  handR: 'foreR',
  thighL: 'pelvis',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'pelvis',
  shinR: 'thighR',
  footR: 'shinR',
  pack: 'chest',
  antenna: 'pack',
};

export type Bones = Record<keyof typeof BONE, Bone>;

/** Build the bone hierarchy in bind pose. Returns the bones by name and as an ordered array. */
export function createBones(): { bones: Bones; list: Bone[] } {
  const names = Object.keys(BONE) as (keyof typeof BONE)[];
  const bones = {} as Bones;
  for (const name of names) {
    const b = new Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of names) {
    const parent = PARENT[name];
    const b = bones[name];
    if (parent) {
      b.position.copy(JOINTS[name]).sub(JOINTS[parent]);
      bones[parent].add(b);
    } else {
      b.position.copy(JOINTS[name]);
    }
  }
  const list = names.map((n) => bones[n]);
  return { bones, list };
}
