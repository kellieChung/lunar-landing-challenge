// Small DOM helpers for the game screens. Buttons are sprite-framed (see
// game.css); every label is a word, with an optional sprite glyph before it.

import type { Tag } from '../constants';
import { sfx } from './sound';
import { sprite } from './sprites';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export type BtnKind = 'plate' | 'go' | 'sq' | 'round' | 'link';

/** A button: `go` = the main action (blue plate), `plate` = wide, `sq` = small square, `round` = icon only. */
export function btn(label: string, onClick: () => void, kind: BtnKind = 'sq', glyph?: string): HTMLButtonElement {
  const b = el('button', `g-b g-b-${kind}`);
  b.type = 'button';
  if (glyph) b.append(sprite(glyph, { label: kind === 'round' ? label : undefined }));
  if (kind !== 'round' || !glyph) b.append(el('span', 'g-b-label', label));
  else b.setAttribute('aria-label', label);
  b.title = kind === 'round' ? label : '';
  b.onclick = () => {
    sfx.click();
    onClick();
  };
  return b;
}

export interface Meter {
  el: HTMLElement;
  set(fraction: number, color?: PipColor): void;
}

export type PipColor = 'green' | 'sun' | 'blue' | 'red' | 'purple';

/** A segmented meter of `n` pips; lit pips take the colour, the rest stay dark. */
export function meter(n: number, color: PipColor, label: string): Meter {
  const m = el('span', 'g-meter');
  m.setAttribute('role', 'meter');
  m.setAttribute('aria-label', label);
  m.setAttribute('aria-valuemin', '0');
  m.setAttribute('aria-valuemax', '100');
  const pips = Array.from({ length: n }, () => m.appendChild(el('i', 'g-pip')));
  let shown = -1;
  let shownColor = '';
  return {
    el: m,
    set(f, c = color) {
      const lit = Math.round(Math.max(0, Math.min(1, f)) * n);
      if (lit === shown && c === shownColor) return;
      shown = lit;
      shownColor = c;
      pips.forEach((p, i) => { p.className = i < lit ? `g-pip on ${c}` : 'g-pip'; });
      m.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    },
  };
}

const TAG_HELP: Record<Tag, string> = {
  REAL: 'Real: computed from NASA terrain and the real 2027 sky, or textbook science.',
  ESTIMATE: 'Estimate: an engineering value from a published source, or a replay of the game rules on the real sky.',
  HYPOTHETICAL: 'Made up: nobody has measured or built this yet. A labelled guess.',
};

/** A REAL / ESTIMATE / HYPOTHETICAL label; clicking it explains it in one sentence. */
export function tag(t: Tag | 'RULE'): HTMLElement {
  const b = el('button', `g-tag g-tag-${t.toLowerCase()}`, t === 'HYPOTHETICAL' ? 'MADE UP' : t);
  b.type = 'button';
  const help = t === 'RULE' ? 'Game rule: a choice we made so the game follows the science idea.' : TAG_HELP[t];
  b.title = help;
  b.onclick = (ev) => {
    ev.stopPropagation();
    b.classList.toggle('open');
    b.dataset.help = help;
  };
  return b;
}

export const kg = (v: number) => (v >= 100 ? `${Math.round(v)} kg` : v >= 10 ? `${v.toFixed(0)} kg` : `${v.toFixed(1)} kg`);
export const dur = (h: number) => (h >= 36 ? `${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h`);
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
