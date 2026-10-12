import { Vector3, type Camera } from 'three';
import type { GameDebugState } from '../game/game';
import { ROLES } from '../game/player';
import { h } from './dom';

const PHASE_TEXT: Record<GameDebugState['phase'], string> = {
  menu: '',
  solo: 'Exploring alone',
  waiting: 'Waiting for your partner…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Partner disconnected',
  failed: 'Connection failed',
};

const TRANSPORT_TEXT: Record<string, string> = { p2p: 'direct', relay: 'relay', local: 'local' };

/** Room code, connection status and floating name tags. */
export class Hud {
  readonly el: HTMLDivElement;
  private code: HTMLDivElement;
  private status: HTMLDivElement;
  private role: HTMLDivElement;
  private labels = new Map<string, HTMLDivElement>();
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private tmp = new Vector3();

  constructor(private readonly root: HTMLElement) {
    this.code = h('div.code');
    this.status = h('div.status');
    this.role = h('div');
    this.el = h('div.hud.panel.hidden', { 'data-testid': 'hud' }, this.code, this.role, this.status);
    this.toastEl = h('div.toast.panel.hidden');
    root.append(this.el, this.toastEl);
  }

  show(roomCode: string | null): void {
    this.el.classList.remove('hidden');
    this.code.textContent = roomCode ?? '';
    this.code.classList.toggle('hidden', !roomCode);
  }

  update(state: GameDebugState): void {
    const detail = state.transport && state.phase === 'connected' ? ` (${TRANSPORT_TEXT[state.transport] ?? state.transport})` : '';
    this.status.className = `status ${state.phase}`;
    this.status.replaceChildren(h('span.dot'), PHASE_TEXT[state.phase] + detail);
    if (state.role) {
      this.role.textContent = `You are the ${ROLES[state.role].name}`;
      this.role.style.color = ROLES[state.role].css;
    }
  }

  /** Place a name tag above a world position; hidden when `pos` is null. */
  label(id: string, text: string, color: string, pos: Vector3 | null, camera: Camera): void {
    let el = this.labels.get(id);
    if (!el) {
      el = h('div.name-label');
      this.root.append(el);
      this.labels.set(id, el);
    }
    if (!pos) {
      el.classList.add('hidden');
      return;
    }
    this.tmp.copy(pos).setY(pos.y + 2.2).project(camera);
    const visible = this.tmp.z < 1;
    el.classList.toggle('hidden', !visible);
    el.textContent = text;
    el.style.color = color;
    el.style.left = `${((this.tmp.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - this.tmp.y) / 2) * window.innerHeight}px`;
  }

  toast(text: string, ms = 2500): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }
}
