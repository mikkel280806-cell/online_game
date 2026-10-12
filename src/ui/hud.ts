import { Vector3, type Camera } from 'three';
import type { GameDebugState } from '../game/game';
import { ROLES } from '../game/roles';
import { h } from './dom';

const PHASE_TEXT: Record<GameDebugState['phase'], string> = {
  menu: '',
  solo: 'Solo · B toggles the bot partner',
  waiting: 'Waiting for your partner…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Partner disconnected',
  failed: 'Connection failed',
};

const TRANSPORT_TEXT: Record<string, string> = { p2p: 'direct', relay: 'relay', local: 'local' };

/** A floating name tag. Remembers what it shows so a frame writes to the DOM only on change. */
interface Label {
  el: HTMLDivElement;
  text: string;
  color: string;
  visible: boolean;
  x: number;
  y: number;
}

/**
 * Room code, connection status and floating name tags.
 * Called every frame, so it touches the DOM only when something changed: DOM writes trigger
 * style and layout work in the browser, which shows up as frame-time spikes.
 */
export class Hud {
  readonly el: HTMLDivElement;
  private code: HTMLDivElement;
  private status: HTMLDivElement;
  private statusText: Text;
  private role: HTMLDivElement;
  private labels = new Map<string, Label>();
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private tmp = new Vector3();
  private lastStatus = '';
  private lastRole = '';

  constructor(private readonly root: HTMLElement) {
    this.code = h('div.code');
    this.statusText = document.createTextNode('');
    this.status = h('div.status', {}, h('span.dot'), this.statusText);
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
    const key = `${state.phase}|${detail}`;
    if (key !== this.lastStatus) {
      this.lastStatus = key;
      this.status.className = `status ${state.phase}`;
      this.statusText.data = PHASE_TEXT[state.phase] + detail;
    }
    if (state.role && state.role !== this.lastRole) {
      this.lastRole = state.role;
      this.role.textContent = `You are the ${ROLES[state.role].name}`;
      this.role.style.color = ROLES[state.role].css;
    }
  }

  /** Place a name tag above a world position; hidden when `pos` is null. */
  label(id: string, text: string, color: string, pos: Vector3 | null, camera: Camera): void {
    let l = this.labels.get(id);
    if (!l) {
      const el = h('div.name-label.hidden');
      this.root.append(el);
      l = { el, text: '', color: '', visible: false, x: NaN, y: NaN };
      this.labels.set(id, l);
    }
    let visible = !!pos;
    if (pos) {
      this.tmp.copy(pos).setY(pos.y + 2.2).project(camera);
      visible = this.tmp.z < 1;
    }
    if (visible !== l.visible) {
      l.visible = visible;
      l.el.classList.toggle('hidden', !visible);
    }
    if (!visible) return;
    if (text !== l.text) l.el.textContent = l.text = text;
    if (color !== l.color) l.el.style.color = l.color = color;
    // Whole pixels, and a transform (compositor only) rather than left/top (layout).
    const x = Math.round(((this.tmp.x + 1) / 2) * window.innerWidth);
    const y = Math.round(((1 - this.tmp.y) / 2) * window.innerHeight);
    if (x !== l.x || y !== l.y) {
      l.x = x;
      l.y = y;
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  toast(text: string, ms = 2500): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }
}
