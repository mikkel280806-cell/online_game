import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  type Scene,
} from 'three';
import { MAST } from '../env/props/layout';
import type { HeightFn } from '../env/types';
import { STATIONS, type Mission, type StationId } from './mission';

const CYAN = new Color('#5fd8ff');

/** Ground rings marking where to work next, and the mast beacon once it's back on. */
export class MissionFx {
  private markers = new Map<StationId, Group>();
  private beacon: Group;
  private beaconMat: MeshBasicMaterial;

  constructor(scene: Scene, heightAt: HeightFn) {
    for (const id of Object.keys(STATIONS) as StationId[]) {
      const s = STATIONS[id];
      const g = new Group();
      g.position.set(s.x, heightAt(s.x, s.z) + 0.04, s.z);
      const mat = (opacity: number) =>
        new MeshBasicMaterial({ color: CYAN, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false });
      const ring = new Mesh(new RingGeometry(1.25, 1.45, 48), mat(0.8));
      ring.rotation.x = -Math.PI / 2;
      // A faint column so the spot reads from across the outpost.
      const column = new Mesh(new CylinderGeometry(1.35, 1.35, 6, 32, 1, true), mat(0.07));
      column.position.y = 3;
      g.add(ring, column);
      g.visible = false;
      scene.add(g);
      this.markers.set(id, g);
    }

    this.beacon = new Group();
    this.beacon.position.set(MAST.x, heightAt(MAST.x, MAST.z) + MAST.height + 0.4, MAST.z);
    this.beaconMat = new MeshBasicMaterial({ color: new Color(4, 0.5, 0.35) });
    this.beacon.add(new Mesh(new SphereGeometry(0.22, 16, 12), this.beaconMat));
    this.beacon.visible = false;
    scene.add(this.beacon);
  }

  update(time: number, mission: Mission): void {
    const active = mission.activeStations();
    const pulse = 0.75 + 0.25 * Math.sin(time * 4);
    for (const [id, g] of this.markers) {
      g.visible = active.includes(id);
      if (!g.visible) continue;
      g.scale.setScalar(1 + 0.04 * Math.sin(time * 4));
      ((g.children[0] as Mesh).material as MeshBasicMaterial).opacity = 0.35 + 0.5 * pulse * (0.4 + 0.6 * mission.progress);
    }
    this.beacon.visible = mission.done;
    if (mission.done) {
      // Slow aviation-style blink. Emissive + bloom only: a real light would recompile every lit shader.
      const on = Math.pow(Math.max(0, Math.sin(time * 2.4)), 6);
      this.beaconMat.color.setRGB(0.4 + 4 * on, 0.06 + 0.5 * on, 0.04 + 0.35 * on);
    }
  }
}
