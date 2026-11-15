// The first-run tutorial: how to pick a good landing spot and a good crater.
// Tooltips (src/ui/Tip.ts) point at the real things to read: the Sun and
// Earth markers, the year timeline, the map, and the reveal's rows. Shown
// once per browser, skippable at any step, replayable from the menu. It
// explains what to look for and never says which option is best.

import { Tip } from '../../ui/Tip';

const KEY = 'moonbase:tutorial:v1';

/** Has the player finished or skipped the tutorial (in this browser)? */
export function tutorialDone(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setTutorialDone(): void {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // not remembered: the tutorial may show again
  }
}

export function resetTutorial(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to reset
  }
}

export interface CoachStep {
  target: () => Element | null;
  text: string;
  hint?: string | (() => string);
}

/** Minimal view of a tooltip, so the step logic can be tested without a DOM layout. */
export interface TipLike {
  show(o: { target: Element; text: string; step?: string; hint?: string; next?: string; onNext?: () => void; onSkip?: () => void; skipLabel?: string }): void;
  hide(): void;
}

/** A target that is missing or not rendered (display: none, e.g. the No-timeline modifier) is skipped. */
const usable = (t: Element | null): t is Element => !!t && t.isConnected && t.getClientRects().length > 0;

export class Coach {
  private on: boolean;
  private seen = new Set<string>();
  private tip: TipLike | null;
  private cancel: (() => void) | null = null;

  constructor(on = !tutorialDone(), tip?: TipLike) {
    this.on = on;
    this.tip = tip ?? null;
  }

  /** The tutorial is running (not finished, not skipped). */
  get active(): boolean {
    return this.on;
  }

  /** Has this beat already played in this run? */
  played(id: string): boolean {
    return this.seen.has(id);
  }

  /** Skip the rest: no more tips, remembered for this browser. */
  skip(): void {
    this.on = false;
    setTutorialDone();
    this.hide();
  }

  /** The whole tutorial has played to the end. */
  finish(): void {
    this.on = false;
    setTutorialDone();
  }

  hide(): void {
    this.tip?.hide();
    const c = this.cancel;
    this.cancel = null;
    c?.();
  }

  /**
   * Play a beat once per run: its steps in order, each waiting for Next.
   * Resolves when the last one is read, when the beat is skipped or
   * interrupted, or at once if it already played or the tutorial is off.
   */
  beat(id: string, steps: CoachStep[]): Promise<void> {
    if (!this.on || this.seen.has(id)) return Promise.resolve();
    this.seen.add(id);
    this.hide(); // one beat at a time: a new one replaces what was showing
    this.tip ??= new Tip('g-tip');
    const tip = this.tip;
    const live = steps.filter((s) => usable(s.target()));
    return new Promise<void>((resolve) => {
      let i = 0;
      const done = () => {
        if (this.cancel === done) this.cancel = null;
        tip.hide();
        resolve();
      };
      this.cancel = done;
      const show = () => {
        if (this.cancel !== done) return; // replaced or skipped meanwhile
        // Re-check: the layout may have changed since the beat started.
        while (i < live.length && !usable(live[i].target())) i++;
        if (i >= live.length) { done(); return; }
        const s = live[i];
        const last = i === live.length - 1;
        tip.show({
          target: s.target()!,
          text: s.text,
          hint: typeof s.hint === 'function' ? s.hint() : s.hint,
          step: live.length > 1 ? `Tutorial · ${i + 1} of ${live.length}` : 'Tutorial',
          next: last ? 'Got it' : 'Next',
          onNext: () => { i++; show(); },
          onSkip: () => { this.skip(); resolve(); },
          skipLabel: 'Skip tutorial',
        });
      };
      show();
    });
  }
}
