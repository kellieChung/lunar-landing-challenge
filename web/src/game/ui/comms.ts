// Mission control: the mascot's portrait (its face follows the base) and one
// line of radio talk, typed out. It only appears while it has something to
// say: a passing line fades out a few seconds after it's typed; a blocking
// line (only three in a run, game.MD v3 §7) waits for the player. Every line
// is kept for the menu's Radio log.

import { el, reducedMotion } from './dom';
import { mascot, setMood, sprite } from './sprites';

export type Mood = 'idle' | 'talk' | 'happy' | 'cheer' | 'love' | 'sad' | 'angry' | 'sleepy' | 'zzz' | 'cool';

const LINGER_MS = 6000;

export class Comms {
  readonly el: HTMLElement;
  private face: HTMLElement;
  private line: HTMLElement;
  private more: HTMLElement;
  private typing = 0;
  private hideTimer = 0;
  private resting: Mood = 'idle';
  private waiter: (() => void) | null = null;
  private full = '';
  private log: string[] = [];
  onBlock: ((on: boolean) => void) | null = null;

  constructor() {
    this.el = el('section', 'g-comms');
    this.el.setAttribute('aria-label', 'Mission control');
    this.el.hidden = true;
    const portrait = el('div', 'g-portrait');
    this.face = mascot('idle');
    portrait.append(this.face);
    const box = el('div', 'g-dlg g-comms-box');
    this.line = el('p', 'g-comms-line');
    this.line.setAttribute('role', 'status');
    this.more = sprite('cont', { loop: 0.8, cls: 'g-cont' });
    this.more.hidden = true;
    box.append(this.line, this.more);
    this.el.append(portrait, box);
    this.el.addEventListener('click', () => this.advance());
  }

  /** Every line so far, newest first. */
  history(): string[] {
    return [...this.log];
  }

  /** The face the mascot rests on when it isn't talking. */
  mood(m: Mood): void {
    this.resting = m;
    if (!this.typing) setMood(this.face, m);
  }

  /** A passing line: typed out, logged, then it fades away. */
  say(text: string, mood?: Mood): void {
    if (mood) this.resting = mood;
    this.type(text);
  }

  /** A blocking line: play stops until the player continues. */
  hold(text: string, mood?: Mood): Promise<void> {
    if (mood) this.resting = mood;
    this.type(text);
    this.el.classList.add('blocking');
    this.more.hidden = false;
    this.onBlock?.(true);
    return new Promise((resolve) => {
      this.waiter = () => {
        this.waiter = null;
        this.el.classList.remove('blocking');
        this.more.hidden = true;
        this.onBlock?.(false);
        this.linger();
        resolve();
      };
    });
  }

  get blocking(): boolean {
    return this.waiter !== null;
  }

  /** Click / Enter: finish the line being typed, continue past a blocking one, or dismiss. */
  advance(): void {
    if (this.typing) {
      this.finishTyping();
      return;
    }
    if (this.waiter) this.waiter();
    else this.hide();
  }

  private show(): void {
    window.clearTimeout(this.hideTimer);
    this.el.hidden = false;
  }

  private hide(): void {
    window.clearTimeout(this.hideTimer);
    if (!this.waiter) this.el.hidden = true;
  }

  private linger(): void {
    window.clearTimeout(this.hideTimer);
    if (!this.waiter) this.hideTimer = window.setTimeout(() => this.hide(), LINGER_MS);
  }

  private type(text: string): void {
    this.finishTyping();
    this.show();
    this.full = text;
    this.log.unshift(text);
    if (this.log.length > 60) this.log.pop();
    setMood(this.face, 'talk');
    if (reducedMotion()) {
      this.line.textContent = text;
      this.rest();
      return;
    }
    let i = 0;
    this.line.textContent = '';
    const tick = () => {
      i = Math.min(text.length, i + 2);
      this.line.textContent = text.slice(0, i);
      if (i < text.length) this.typing = window.setTimeout(tick, 28);
      else {
        this.typing = 0;
        this.rest();
      }
    };
    this.typing = window.setTimeout(tick, 28);
  }

  private finishTyping(): void {
    if (!this.typing) return;
    window.clearTimeout(this.typing);
    this.typing = 0;
    this.line.textContent = this.full;
    this.rest();
  }

  private rest(): void {
    setMood(this.face, this.resting);
    this.linger();
  }
}
