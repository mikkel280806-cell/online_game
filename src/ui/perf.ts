import type { Renderer } from '../engine/renderer';
import type { FrameStats } from '../engine/stats';
import type { GameDebugState } from '../game/game';
import { h } from './dom';

/** F3 overlay: frame rate, frame time, resolution scale, draw calls and network. */
export class PerfOverlay {
  readonly el: HTMLDivElement;
  private visible = false;
  private nextUpdate = 0;

  constructor(root: HTMLElement) {
    this.el = h('div.perf.panel.hidden', { 'data-testid': 'perf' });
    root.append(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }

  update(nowMs: number, stats: FrameStats, renderer: Renderer, state: GameDebugState): void {
    if (!this.visible || nowMs < this.nextUpdate) return;
    this.nextUpdate = nowMs + 250;
    const info = renderer.gl.info.render;
    const drs = renderer.resolutionInfo();
    this.el.textContent = [
      `fps      ${stats.fps().toFixed(0)}`,
      `frame    ${stats.avgMs().toFixed(1)} ms  p95 ${stats.p95Ms().toFixed(1)}`,
      `scale    ${renderer.getPixelRatio().toFixed(2)}x  ${renderer.getQuality()}  (${drs.min}-${drs.max})`,
      `drs      ${drs.reason || '-'}`,
      `draws    ${info.calls}`,
      `tris     ${(info.triangles / 1000).toFixed(0)}k`,
      `net      ${state.transport ?? '-'}  ${state.rttMs !== null ? `${state.rttMs.toFixed(0)} ms` : ''}`,
      `pos      ${state.local ? `${state.local.x.toFixed(1)}, ${state.local.z.toFixed(1)}` : '-'}`,
    ].join('\n');
  }
}
