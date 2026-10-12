import { h } from './dom';

export interface LobbyActions {
  create(): Promise<void>;
  join(code: string): Promise<void>;
  solo(): void;
}

/** Title screen with create / join / practice. Resolves its promise-returning actions to show errors. */
export class Lobby {
  readonly el: HTMLDivElement;
  private error: HTMLDivElement;
  private input: HTMLInputElement;
  private buttons: HTMLButtonElement[];

  constructor(actions: LobbyActions) {
    this.error = h('div.lobby-error');
    this.input = h('input', { maxlength: 4, placeholder: 'CODE', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Room code' });
    const createBtn = h('button.btn', { text: 'Create room', 'data-testid': 'create' });
    const joinBtn = h('button.btn', { text: 'Join', 'data-testid': 'join' });
    const soloBtn = h('button.btn.secondary', { text: 'Play solo with a bot partner', 'data-testid': 'solo' });
    this.buttons = [createBtn, joinBtn, soloBtn];

    const run = async (fn: () => Promise<void>) => {
      this.setBusy(true);
      this.error.textContent = '';
      try {
        await fn();
      } catch (e) {
        this.error.textContent = e instanceof Error ? e.message : String(e);
        this.setBusy(false);
      }
    };
    createBtn.addEventListener('click', () => run(actions.create));
    joinBtn.addEventListener('click', () => run(() => actions.join(this.input.value)));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinBtn.click();
    });
    soloBtn.addEventListener('click', () => actions.solo());

    this.el = h(
      'div.lobby',
      {},
      h(
        'div.lobby-inner',
        {},
        h('h1.title', { text: 'HOLLOW STAR' }),
        h('p.subtitle', { text: 'A two-player odyssey' }),
        h(
          'div.panel',
          {},
          createBtn,
          h('div.join-row', {}, this.input, joinBtn),
          soloBtn,
          this.error,
        ),
        h(
          'div.controls-hint',
          {},
          h('kbd', { text: 'WASD' }), ' move · ', h('kbd', { text: 'Shift' }), ' sprint · drag / swipe to look · scroll to zoom · ',
          h('kbd', { text: 'F' }), ' interact · ', h('kbd', { text: 'F8' }), ' feedback',
        ),
      ),
    );
  }

  hide(): void {
    this.el.classList.add('fading');
    setTimeout(() => this.el.classList.add('hidden'), 650);
  }

  private setBusy(busy: boolean): void {
    this.buttons.forEach((b) => (b.disabled = busy));
  }
}
