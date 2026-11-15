// Mission control: the mascot's portrait (its face follows the base) and one
// line of radio talk, typed out. Every line waits for the player to press
// Next (click, Space or Enter); nothing skips by itself. Lines that arrive
// while one is showing queue up behind it, and the game clock stays stopped
// while any line is showing or waiting, so the talk never falls behind the
// game. While a panel owns the screen the line is suspended: hidden, and
// picked up again when the panel closes. Every line is kept for the menu's
// Radio log.

import { el, reducedMotion } from './dom';
import { mascot, setMood, sprite } from './sprites';
import { sfx } from './sound';

export type Mood = 'idle' | 'talk' | 'happy' | 'cheer' | 'love' | 'sad' | 'angry' | 'sleepy' | 'zzz' | 'cool';

const TYPE_MS = 32; // per character
const MET_KEY = 'moonbase:met-frog';

/** Has the player been introduced to Astrofrog (in this browser)? */
export function metFrog(): boolean {
  try {
    return window.localStorage.getItem(MET_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMetFrog(): void {
  try {
    window.localStorage.setItem(MET_KEY, '1');
  } catch {
    // not remembered: the intro may show again
  }
}

/** `loud`: a big moment (bigger text, gold pulse). `next`: the button word instead of "Next". */
export interface LineOpts {
  loud?: boolean;
  next?: string;
}

interface Line {
  text: string;
  mood?: Mood;
  tag?: string;
  opts?: LineOpts;
  done: () => void;
}

export class Comms {
  readonly el: HTMLElement;
  private face: HTMLElement;
  private line: HTMLElement;
  private next: HTMLButtonElement;
  private typing = 0;
  private typed = 0; // characters of the current line shown so far
  private started = false; // the current line has begun typing (ding + log done)
  private suspended = false;
  private resting: Mood = 'idle';
  private current: Line | null = null;
  private queue: Line[] = [];
  private full = '';
  private log: string[] = [];
  private idlers: (() => void)[] = [];
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
    this.next = el('button', 'g-comms-next');
    this.next.type = 'button';
    this.next.append(el('span', 'g-comms-next-word', 'Next'), sprite('cont', { loop: 0.8, cls: 'g-cont' }));
    this.next.setAttribute('aria-label', 'Next');
    box.append(el('span', 'g-comms-name', 'Astrofrog · mission control'), this.line, this.next);
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

  /** Say a line; it waits for the player. Resolves when they press Next (or the line is dropped). */
  say(text: string, mood?: Mood, tag?: string, opts?: LineOpts): Promise<void> {
    return new Promise((done) => {
      this.queue.push({ text, mood, tag, opts, done });
      if (!this.current) this.showNext();
    });
  }

  /** Same as say(): kept for the call sites that read as "hold here". */
  hold(text: string, mood?: Mood, tag?: string, opts?: LineOpts): Promise<void> {
    return this.say(text, mood, tag, opts);
  }

  /** Resolves once every queued line has been read (at once if none). */
  idle(): Promise<void> {
    if (!this.current) return Promise.resolve();
    return new Promise((res) => this.idlers.push(res));
  }

  /** A line is showing or waiting: the game clock must not run. */
  get blocking(): boolean {
    return this.current !== null;
  }

  /** A line is on screen (not hidden behind a panel). */
  get showing(): boolean {
    return this.current !== null && !this.suspended;
  }

  /**
   * Hide the radio while a panel owns the screen (menu, choice, reveal, launch).
   * The line waits, untouched, and carries on typing where it stopped once the
   * panel is gone, so talk never sits on top of a panel or is missed under one.
   */
  suspend(on: boolean): void {
    if (on === this.suspended) return;
    this.suspended = on;
    if (on) {
      if (this.typing) {
        window.clearTimeout(this.typing);
        this.typing = 0;
      }
      this.el.hidden = true;
      return;
    }
    if (!this.current) return;
    this.el.hidden = false;
    if (!this.started) this.type(this.current.text);
    else if (this.typed < this.full.length) {
      setMood(this.face, 'talk');
      this.tick();
    }
    else this.rest();
  }

  /** Forget lines that no longer apply (all of them, or those with `tag`); their promises resolve. */
  drop(tag?: string): void {
    const hit = (l: Line) => tag === undefined || l.tag === tag;
    const gone = this.queue.filter(hit);
    this.queue = this.queue.filter((l) => !hit(l));
    for (const l of gone) l.done();
    if (this.current && hit(this.current)) {
      const line = this.current;
      if (this.typing) window.clearTimeout(this.typing);
      this.typing = 0;
      this.current = null;
      line.done();
      if (this.queue.length) this.showNext();
      else this.settle();
    }
  }

  /** Click / Space / Enter: finish typing first, then go to the next line. */
  advance(): void {
    if (!this.current || this.suspended) return;
    if (this.typing) {
      this.finishTyping();
      return;
    }
    const line = this.current;
    this.current = null;
    line.done();
    if (this.queue.length) this.showNext();
    else this.settle();
  }

  /** Nothing left to say: hide, and let the clock and anyone waiting go. */
  private settle(): void {
    this.el.hidden = true;
    setMood(this.face, this.resting);
    this.onBlock?.(false);
    for (const f of this.idlers.splice(0)) f();
  }

  private showNext(): void {
    const line = this.queue.shift()!;
    const was = this.current !== null || !this.el.hidden;
    this.current = line;
    this.started = false;
    if (line.mood) this.resting = line.mood;
    this.el.classList.toggle('loud', !!line.opts?.loud);
    this.next.querySelector('.g-comms-next-word')!.textContent = line.opts?.next ?? 'Next';
    if (!this.suspended) this.type(line.text);
    if (!was) this.onBlock?.(true);
  }

  private type(text: string): void {
    this.el.hidden = false;
    this.started = true;
    sfx.ding();
    this.full = text;
    this.log.unshift(text);
    if (this.log.length > 60) this.log.pop();
    this.next.hidden = true;
    setMood(this.face, 'talk');
    if (reducedMotion()) {
      this.typed = text.length;
      this.line.textContent = text;
      this.rest();
      return;
    }
    this.typed = 0;
    this.line.textContent = '';
    this.typing = window.setTimeout(() => this.tick(), TYPE_MS);
  }

  private tick(): void {
    this.typed = Math.min(this.full.length, this.typed + 1);
    this.line.textContent = this.full.slice(0, this.typed);
    if (this.typed < this.full.length) this.typing = window.setTimeout(() => this.tick(), TYPE_MS);
    else {
      this.typing = 0;
      this.rest();
    }
  }

  private finishTyping(): void {
    if (!this.typing) return;
    window.clearTimeout(this.typing);
    this.typing = 0;
    this.typed = this.full.length;
    this.line.textContent = this.full;
    this.rest();
  }

  private rest(): void {
    setMood(this.face, this.resting);
    this.next.hidden = false;
    if (!this.suspended) this.next.focus({ preventScroll: true });
  }
}
