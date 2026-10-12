import { MAST_CABINET, PEDESTAL } from '../env/props/layout';
import type { RoleId } from './roles';

// The first co-op objective: restart the outpost's distress beacon. Each role has a step only
// it can do, and the last step needs both players at once, 20 m apart. Pure logic: the host (or
// the solo player) runs it; the guest only displays the host's state.

export type StationId = 'cabinet' | 'terminal';

export const STATIONS: Record<StationId, { x: number; z: number; name: string }> = {
  cabinet: { x: MAST_CABINET.x, z: MAST_CABINET.z, name: 'mast power cabinet' },
  terminal: { x: PEDESTAL.x, z: PEDESTAL.z, name: 'pad power pedestal' },
};

/** How close (m, centre to centre) a player must stand to work a station. */
export const REACH = 2.6;

interface Need {
  station: StationId;
  /** Only this role can do it; null: anyone. */
  role: RoleId | null;
  verb: string;
}

interface Step {
  objective: string;
  needs: Need[];
  /** Seconds of holding the interact key. */
  hold: number;
}

export const STEPS: readonly Step[] = [
  {
    objective: 'Force open the jammed power cabinet at the comms mast',
    needs: [{ station: 'cabinet', role: 'vanguard', verb: 'Force the cabinet open' }],
    hold: 1.5,
  },
  {
    objective: 'Reroute power to the mast from the power pedestal at the landing pad',
    needs: [{ station: 'terminal', role: 'tether', verb: 'Reroute power' }],
    hold: 2.5,
  },
  {
    objective: 'Throw both breakers together: one at the mast, one at the pad pedestal',
    needs: [
      { station: 'cabinet', role: null, verb: 'Hold the breaker' },
      { station: 'terminal', role: null, verb: 'Hold the breaker' },
    ],
    hold: 1.5,
  },
];

export const DONE_TEXT = 'Beacon online. Something in the Meridian wreck is answering.';

export interface Actor {
  role: RoleId;
  x: number;
  z: number;
  /** Holding the interact key. */
  act: boolean;
}

const near = (a: { x: number; z: number }, s: StationId) => Math.hypot(a.x - STATIONS[s].x, a.z - STATIONS[s].z) <= REACH;

export class Mission {
  step = 0;
  /** Progress of the current step, 0..1. */
  progress = 0;

  get done(): boolean {
    return this.step >= STEPS.length;
  }

  get objective(): string {
    return this.done ? DONE_TEXT : STEPS[this.step].objective;
  }

  /** Stations the current step needs. */
  activeStations(): StationId[] {
    return this.done ? [] : STEPS[this.step].needs.map((n) => n.station);
  }

  /** Advance with everyone's position and input. Returns true when a step completes. */
  update(dt: number, actors: readonly Actor[]): boolean {
    if (this.done) return false;
    const s = STEPS[this.step];
    // Every need must be met by a different player.
    const used = new Set<number>();
    const met = s.needs.every((n) => {
      const i = actors.findIndex((a, k) => !used.has(k) && a.act && (n.role === null || a.role === n.role) && near(a, n.station));
      if (i < 0) return false;
      used.add(i);
      return true;
    });
    this.progress = met ? this.progress + dt / s.hold : Math.max(0, this.progress - dt * 0.8);
    if (this.progress < 1) return false;
    this.step++;
    this.progress = 0;
    return true;
  }

  /** Guest side: take the host's state. */
  apply(step: number, progress: number): void {
    if (!Number.isInteger(step) || step < 0 || step > STEPS.length || !Number.isFinite(progress)) return;
    this.step = step;
    this.progress = Math.min(Math.max(progress, 0), 1);
  }

  /** What the interact prompt should say for a player of `role` standing at (x, z), if anything. */
  prompt(role: RoleId, x: number, z: number): { text: string; allowed: boolean } | null {
    if (this.done) return null;
    for (const n of STEPS[this.step].needs) {
      if (!near({ x, z }, n.station)) continue;
      if (n.role && n.role !== role) return { text: `Only the ${n.role === 'vanguard' ? 'Vanguard' : 'Tether'} can do this`, allowed: false };
      return { text: n.verb, allowed: true };
    }
    return null;
  }

  /** Where a bot of `role` should go to help, given where its human partner is. */
  botStation(role: RoleId, partner: { x: number; z: number }): StationId | null {
    if (this.done) return null;
    const needs = STEPS[this.step].needs;
    const own = needs.find((n) => n.role === role);
    if (own) return own.station;
    const open = needs.filter((n) => n.role === null);
    if (open.length < 2) return null;
    // Take the breaker the human isn't heading for: the one farther from them.
    const d = (s: StationId) => Math.hypot(partner.x - STATIONS[s].x, partner.z - STATIONS[s].z);
    return d(open[0].station) > d(open[1].station) ? open[0].station : open[1].station;
  }
}
