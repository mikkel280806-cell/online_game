import { Vector3 } from 'three';
import { mulberry32 } from './random';
import { findPath, segmentClear, type Point } from './pathfinding';
import { LocalPlayer, type Ground, type PlayerControl } from './player';

type BotState = 'follow' | 'idle' | 'explore' | 'task';

const FOLLOW_START = 6.5; // start walking when the leader is this far away
const FOLLOW_STOP = 3.2; // stop when this close to the formation spot
const SPRINT_DIST = 15;
const EXPLORE_AFTER = 7; // seconds of the leader standing still before the bot wanders off

/**
 * A stand-in partner for solo play. It drives a normal LocalPlayer with synthetic input:
 * follows you in formation, catches up at a sprint, wanders to look at things when you stand
 * still, and steers around obstacles. M2 will teach it co-op actions.
 */
export class Bot {
  state: BotState = 'idle';
  private readonly rand = mulberry32(99);
  private stillTime = 0;
  private stateTime = 0;
  private goal = new Vector3();
  private control: PlayerControl = { x: 0, z: 0, sprint: false };
  private side = 1;
  private path: Point[] | null = null;
  private pathGoal: Point = { x: Infinity, z: Infinity };
  private pathAge = 0;
  private ground: Ground | null = null;

  /** A spot to go and work (a mission station): overrides following. */
  task: { x: number; z: number } | null = null;
  /** Holding the interact key at the task spot. */
  holding = false;

  constructor(readonly player: LocalPlayer) {}

  update(dt: number, leader: LocalPlayer, ground: Ground): void {
    this.ground = ground;
    this.pathAge += dt;
    this.stateTime += dt;
    this.stillTime = leader.speed < 0.3 ? this.stillTime + dt : 0;

    // Formation spot: behind and to one side of the leader, relative to where they face.
    const back = leader.speed > 0.5 ? Math.atan2(leader.velocity.x, leader.velocity.z) : leader.yaw;
    const spot = new Vector3(
      leader.position.x - Math.sin(back) * 2.6 + Math.cos(back) * 1.8 * this.side,
      0,
      leader.position.z - Math.cos(back) * 2.6 - Math.sin(back) * 1.8 * this.side,
    );
    const toLeader = Math.hypot(leader.position.x - this.player.position.x, leader.position.z - this.player.position.z);

    if (this.task && this.state !== 'task') this.enter('task');
    this.holding = false;
    switch (this.state) {
      case 'task': {
        if (!this.task) {
          this.enter('idle');
          break;
        }
        const goal = this.goal.set(this.task.x, 0, this.task.z);
        const d = this.distanceTo(goal);
        // Stop at arm's length; the station's own collider keeps us from walking into it.
        if (d > 1.6) this.steer(goal, d > 8);
        else this.steer(null, false);
        this.holding = d < 2.2;
        break;
      }
      case 'idle':
        this.steer(null, false);
        if (toLeader > FOLLOW_START) this.enter('follow');
        else if (this.stillTime > EXPLORE_AFTER && this.stateTime > 3) this.startExplore(leader);
        break;
      case 'follow': {
        const d = this.distanceTo(spot);
        this.steer(spot, toLeader > SPRINT_DIST);
        if (d < FOLLOW_STOP) this.enter('idle');
        break;
      }
      case 'explore':
        this.steer(this.goal, false);
        if (this.distanceTo(this.goal) < 1.2 || this.stateTime > 12) this.enter('idle');
        if (toLeader > 18) this.enter('follow');
        break;
    }

    this.avoidLeader(leader);
    this.detourIfStuck();
    this.player.update(this.control, dt, ground);
    this.measureStuck(dt);
  }

  private enter(state: BotState): void {
    this.state = state;
    this.stateTime = 0;
    if (state === 'follow') this.side = this.rand() < 0.5 ? -1 : 1;
  }

  private startExplore(leader: LocalPlayer): void {
    const a = this.rand() * Math.PI * 2;
    const r = 6 + this.rand() * 9;
    this.goal.set(leader.position.x + Math.cos(a) * r, 0, leader.position.z + Math.sin(a) * r);
    this.stillTime = 0;
    this.enter('explore');
  }

  private distanceTo(p: Vector3): number {
    return Math.hypot(p.x - this.player.position.x, p.z - this.player.position.z);
  }

  private steer(target: Vector3 | null, sprint: boolean): void {
    if (!target) {
      this.control = { x: 0, z: 0, sprint: false };
      this.path = null;
      return;
    }
    const here = this.player.position;
    let aim: Point = target;
    const ground = this.ground;
    // Walk straight when nothing is in the way; otherwise follow an A* route around obstacles.
    if (ground && !segmentClear(here, target, 0.45, ground.colliders, ground.bounds)) {
      const goalMoved = Math.hypot(target.x - this.pathGoal.x, target.z - this.pathGoal.z) > 1.5;
      if (!this.path || goalMoved || this.pathAge > 1.5) {
        this.path = findPath(here, target, 0.45, ground.colliders, ground.bounds);
        this.pathGoal = { x: target.x, z: target.z };
        this.pathAge = 0;
      }
      while (this.path && this.path.length > 1 && Math.hypot(this.path[0].x - here.x, this.path[0].z - here.z) < 0.9) this.path.shift();
      if (this.path?.length) aim = this.path[0];
    } else {
      this.path = null;
    }
    const dx = aim.x - here.x;
    const dz = aim.z - here.z;
    const d = Math.hypot(dx, dz);
    // Slow down on arrival at the final target instead of overshooting.
    const toTarget = Math.hypot(target.x - here.x, target.z - here.z);
    const strength = Math.min(1, toTarget / 2.5);
    this.control = d > 0.01 ? { x: (dx / d) * strength, z: (dz / d) * strength, sprint } : { x: 0, z: 0, sprint: false };
  }

  /** Never walk into the leader: push the desired direction sideways when too close. */
  private avoidLeader(leader: LocalPlayer): void {
    const dx = this.player.position.x - leader.position.x;
    const dz = this.player.position.z - leader.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.6 && d > 0.001) {
      this.control.x += (dx / d) * 0.8;
      this.control.z += (dz / d) * 0.8;
    }
  }

  private stuckFor = 0;
  private detour = 0;
  private detourLength = 1.4;

  /** Wanting to move but making little progress means a collider is in the way. */
  private measureStuck(dt: number): void {
    this.detour = Math.max(0, this.detour - dt);
    // Progress = how fast we actually move in the direction we want to go.
    const wanted = Math.hypot(this.control.x, this.control.z);
    const v = this.player.velocity;
    const progress = wanted > 0 ? (v.x * this.control.x + v.z * this.control.z) / wanted : 0;
    if (wanted > 0.5 && progress < 1.2) this.stuckFor += dt;
    else this.stuckFor = 0;
    if (this.stuckFor > 0.3) {
      // Commit to walking around it; if we were already detouring, go longer and try the other side.
      if (this.detour > 0) {
        this.side = -this.side;
        this.detourLength = Math.min(this.detourLength * 1.6, 5);
      }
      this.detour = this.detourLength;
      this.stuckFor = 0;
    }
    if (this.state !== 'follow' && this.state !== 'explore') this.detourLength = 1.4;
  }

  /** Sidestep around whatever blocks the way by turning the desired direction ~70°. */
  private detourIfStuck(): void {
    if (this.detour <= 0) return;
    const a = 1.2 * this.side;
    const x = this.control.x * Math.cos(a) - this.control.z * Math.sin(a);
    const z = this.control.x * Math.sin(a) + this.control.z * Math.cos(a);
    this.control = { x, z, sprint: false };
  }
}
