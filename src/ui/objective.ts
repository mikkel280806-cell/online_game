import { h } from './dom';

/** Current objective (top left) and the "Hold F" prompt with its progress bar (bottom centre). */
export class ObjectiveUi {
  private readonly objective: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly promptText: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private last = '';

  constructor(root: HTMLElement) {
    this.text = h('div.objective-text');
    this.objective = h('div.objective.panel.hidden', {}, h('div.objective-label', { text: 'Objective' }), this.text);
    this.promptText = h('div.prompt-text');
    this.bar = h('div.prompt-bar');
    this.prompt = h('div.prompt.panel.hidden', {}, this.promptText, h('div.prompt-track', {}, this.bar));
    root.append(this.objective, this.prompt);
  }

  update(visible: boolean, text: string, done: boolean, prompt: { text: string; allowed: boolean; progress: number } | null): void {
    this.objective.classList.toggle('hidden', !visible);
    if (this.last !== text) {
      this.last = text;
      this.text.textContent = text;
      this.objective.classList.toggle('done', done);
      // Replay the highlight so a new objective is noticed.
      this.objective.classList.remove('fresh');
      void this.objective.offsetWidth;
      this.objective.classList.add('fresh');
    }
    const p = visible ? prompt : null;
    this.prompt.classList.toggle('hidden', !p);
    if (!p) return;
    this.promptText.textContent = p.allowed ? `Hold F · ${p.text}` : p.text;
    this.prompt.classList.toggle('blocked', !p.allowed);
    this.bar.style.width = `${Math.round(p.progress * 100)}%`;
  }

}
