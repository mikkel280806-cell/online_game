import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type Vector3,
} from 'three';
import { damp } from '../engine/camera';
import { ROLES, type RoleId } from '../game/roles';

// PLACEHOLDER: the Character agent replaces this with the articulated astronaut.
// Public API to keep: `new Avatar(role)`, `.root`, `.role`, `.animate(position, yaw, speed, dt)`.

const WALK = 5.2;

/** Visual model of a crew member in a suit. Animation is driven by `speed`. */
export class Avatar {
  readonly root = new Group();
  private body = new Group();
  private phase = 0;

  constructor(readonly role: RoleId) {
    const accent = ROLES[role].color;
    const suit = new MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.15, roughness: 0.48 });
    const dark = new MeshStandardMaterial({ color: 0x262a31, metalness: 0.6, roughness: 0.4 });
    const glow = new MeshBasicMaterial({ color: accent, toneMapped: false });
    const visorMat = new MeshStandardMaterial({
      color: 0x05070a,
      metalness: 1,
      roughness: 0.08,
      emissive: accent.clone().multiplyScalar(0.25),
    });

    const torso = new Mesh(new CapsuleGeometry(0.3, 0.55, 6, 16), suit);
    torso.position.y = 0.95;
    const belt = new Mesh(new TorusGeometry(0.31, 0.035, 8, 32), glow);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.78;
    const helmet = new Mesh(new SphereGeometry(0.27, 24, 16), suit);
    helmet.position.y = 1.58;
    const visor = new Mesh(new SphereGeometry(0.22, 24, 16, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.36), visorMat);
    visor.position.set(0, 1.58, 0.07);
    const pack = new Mesh(new BoxGeometry(0.46, 0.55, 0.22), dark);
    pack.position.set(0, 1.05, -0.3);
    const packLights = new Mesh(new BoxGeometry(0.3, 0.04, 0.02), glow);
    packLights.position.set(0, 1.2, -0.42);
    const legs = new Mesh(new CylinderGeometry(0.2, 0.14, 0.5, 12), dark);
    legs.position.y = 0.32;
    const boots = new Mesh(new CylinderGeometry(0.16, 0.18, 0.1, 12), dark);
    boots.position.y = 0.05;

    this.body.add(torso, belt, helmet, visor, pack, packLights, legs, boots);
    this.body.traverse((o) => {
      if (o instanceof Mesh && o.material !== glow) o.castShadow = true;
    });
    this.root.add(this.body);
  }

  /** Set pose for this frame. `speed` in m/s drives the walk cycle. */
  animate(position: Vector3, yaw: number, speed: number, dt: number): void {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
    const moving = Math.min(speed / WALK, 1.6);
    this.phase += dt * (4 + speed * 1.6);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.07 * moving;
    this.body.rotation.x = damp(this.body.rotation.x, moving * 0.12, 10, dt);
    this.body.rotation.z = Math.sin(this.phase) * 0.04 * moving;
  }
}

