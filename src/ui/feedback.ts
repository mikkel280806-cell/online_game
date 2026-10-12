import { h } from './dom';

export interface FeedbackDeps {
  /** Grab the current frame as a small JPEG data URL. */
  captureScreenshot(): Promise<string | null>;
  submit(note: string, screenshot: string | null): Promise<boolean>;
  toast(text: string): void;
}

/** F8 box: write a note, it is sent with a screenshot of what you're looking at. */
export class FeedbackBox {
  readonly el: HTMLDivElement;
  private textarea: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private shot: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly deps: FeedbackDeps,
  ) {
    this.textarea = h('textarea', { placeholder: 'What looks great, what feels off, what broke?', maxlength: 2000 });
    this.sendBtn = h('button.btn', { text: 'Send' });
    const cancel = h('button.btn.secondary', { text: 'Cancel' });
    this.sendBtn.addEventListener('click', () => void this.send());
    cancel.addEventListener('click', () => this.close());
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void this.send();
      e.stopPropagation();
    });
    this.el = h(
      'div.feedback.panel.hidden',
      {},
      h('h3', { text: 'Send feedback' }),
      this.textarea,
      h('div.row', {}, h('span.note', { text: 'A screenshot is attached. ⌘+Enter to send.' }), cancel, this.sendBtn),
    );
    root.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    this.shot = await this.deps.captureScreenshot();
    this.el.classList.remove('hidden');
    this.textarea.value = '';
    this.textarea.focus();
  }

  close(): void {
    this.el.classList.add('hidden');
    this.textarea.blur();
  }

  private async send(): Promise<void> {
    const note = this.textarea.value.trim();
    if (!note) return;
    this.sendBtn.disabled = true;
    const ok = await this.deps.submit(note, this.shot);
    this.sendBtn.disabled = false;
    this.close();
    this.deps.toast(ok ? 'Feedback sent — thank you!' : 'Could not send feedback (offline?)');
  }
}
