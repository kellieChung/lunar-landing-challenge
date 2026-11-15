// Look-and-compare (game.MD v3 §4): a full-screen choice whose cards give no
// numbers away, a slim bar while you go and look, and the reveal afterwards.

import type { Tag } from '../constants';
import { btn, el, tag } from './dom';
import { sprite } from './sprites';

export interface ChoiceOption {
  glyph?: string;
  title: string;
  label?: string;
  look?: () => void;
  chooseLabel: string;
  choose: () => void;
}

export class Chooser {
  readonly el: HTMLElement;
  readonly bar: HTMLElement;
  private opts: ChoiceOption[] = [];
  private title = '';
  onLook: ((i: number) => void) | null = null;
  onChange: (() => void) | null = null;

  constructor() {
    this.el = el('div', 'g-chooser');
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.bar = el('div', 'g-lookbar g-dlg');
    this.bar.hidden = true;
  }

  get open(): boolean {
    return !this.el.hidden || !this.bar.hidden;
  }

  show(title: string, sub: string, opts: ChoiceOption[], extra?: { label: string; onClick: () => void }): void {
    this.opts = opts;
    this.title = title;
    const box = el('div', 'g-chooser-box');
    box.append(el('h2', 'g-h', title), el('p', 'g-sub', sub));
    const row = el('div', 'g-cards');
    opts.forEach((o, i) => {
      const card = el('div', 'g-card g-dlg');
      if (o.glyph) card.append(sprite(o.glyph, { scale: 2, cls: 'g-card-glyph' }));
      card.append(el('h3', 'g-card-title', o.title));
      if (o.label) card.append(el('p', 'g-card-label', o.label));
      const btns = el('div', 'g-card-btns');
      if (o.look) btns.append(btn('Go look', () => this.look(i), 'plate', 'arrow-u'));
      btns.append(btn(o.chooseLabel, () => this.pick(i), 'go'));
      card.append(btns);
      row.append(card);
    });
    box.append(row);
    if (extra) box.append(btn(extra.label, extra.onClick, 'link'));
    this.el.replaceChildren(box);
    this.bar.hidden = true;
    this.el.hidden = false;
    this.onChange?.();
    (row.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private look(i: number): void {
    const o = this.opts[i];
    o.look?.();
    this.onLook?.(i);
    this.el.hidden = true;
    const others = this.opts.map((x, j) => ({ x, j })).filter(({ x, j }) => j !== i && x.look);
    this.bar.replaceChildren(
      el('span', 'g-look-what', `Looking at ${o.title}`),
      el('span', 'g-look-hint', 'Drag to look around. The timeline below shows the whole year here.'),
      ...others.map(({ x, j }) => btn(x.title, () => this.look(j), 'sq', 'arrow-r')),
      btn('All choices', () => { this.bar.hidden = true; this.el.hidden = false; }, 'sq', 'arrow-l'),
      btn(o.chooseLabel, () => this.pick(i), 'go'),
    );
    this.bar.hidden = false;
  }

  private pick(i: number): void {
    this.close();
    this.opts[i].choose();
  }

  close(): void {
    this.el.hidden = true;
    this.bar.hidden = true;
    this.onChange?.();
  }

  get current(): string {
    return this.title;
  }
}

// ---- Reveal ----------------------------------------------------------------

export interface RevealRow {
  name: string;
  tag: Tag | 'RULE';
  values: string[];
  winners: number[]; // option indices that win this row (tick)
}

export interface RevealSpec {
  title: string;
  names: string[];
  picked: number;
  rows: RevealRow[];
  projection: string[];
  projWinners: number[];
  points: number;
  why?: string;
  note?: string;
}

/** The reveal panel, docked at the bottom so the 3D view (and the ridge flash) stays in sight. */
export function revealPanel(spec: RevealSpec, onDone: () => void): HTMLElement {
  const p = el('div', 'g-reveal g-dlg');
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', spec.title);
  const head = el('div', 'g-reveal-head');
  head.append(el('h2', 'g-h', spec.title));
  const pts = el('span', 'g-points');
  pts.append(el('span', '', 'Sky Sense'), el('b', '', `+${spec.points}`));
  const go = btn('Continue', onDone, 'go', 'arrow-r');
  head.append(pts, go);
  p.append(head);

  const table = el('table', 'g-reveal-table');
  const thead = el('tr');
  thead.append(el('th'));
  spec.names.forEach((n, i) => {
    const th = el('th', i === spec.picked ? 'picked' : '');
    th.append(el('span', '', n));
    if (i === spec.picked) th.append(el('span', 'g-yours', 'your pick'));
    thead.append(th);
  });
  table.append(thead);
  const addRow = (name: string, values: string[], winners: number[], cls = '') => {
    const tr = el('tr', cls);
    const th = el('th');
    th.append(el('span', '', name));
    tr.append(th);
    values.forEach((v, i) => {
      const td = el('td', `${i === spec.picked ? 'picked' : ''} ${winners.includes(i) ? 'win' : ''}`);
      if (winners.includes(i)) td.append(sprite('i-check', { label: 'best' }));
      td.append(el('span', '', v));
      tr.append(td);
    });
    table.append(tr);
  };
  for (const r of spec.rows) addRow(r.name, r.values, r.winners);
  addRow('Projected launch', spec.projection, spec.projWinners, 'g-proj');
  p.append(table);
  // One legend line instead of a tag on every row: which numbers are real, which are not.
  const groups = new Map<Tag | 'RULE', string[]>();
  for (const r of [...spec.rows, { name: 'projected launch', tag: 'ESTIMATE' as const }]) {
    groups.set(r.tag, [...(groups.get(r.tag) ?? []), r.name.toLowerCase()]);
  }
  const legend = el('p', 'g-legend');
  for (const [t, names] of groups) {
    const item = el('span');
    item.append(tag(t), document.createTextNode(names.join(', ')));
    legend.append(item);
  }
  p.append(legend);
  if (spec.why) {
    const why = el('p', 'g-why');
    why.append(sprite('i-alert', { label: 'Why' }), el('span', '', spec.why));
    p.append(why);
  }
  if (spec.note) p.append(el('p', 'g-small', spec.note));
  window.setTimeout(() => go.focus(), 50);
  return p;
}
