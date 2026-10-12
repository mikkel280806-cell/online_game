/**
 * Keyboard state by physical key (`KeyboardEvent.code`), so WASD sits in the same
 * place on any keyboard layout.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** When false (e.g. typing in a text box), game keys are ignored. */
  enabled = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  /** Movement intent in screen space: x right, y up. Not normalised. */
  moveAxis(): { x: number; y: number } {
    const x = (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0);
    const y = (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0) - (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0);
    return { x, y };
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
