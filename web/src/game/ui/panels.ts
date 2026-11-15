// Full-screen panels: the mission brief, the report card, the menu and its
// guide page (how to play, radio log, Moon facts, what's real, credits).

import { FACTS, NOT_MODELLED } from '../facts';
import type { Mods } from '../run';
import { SPOT_CHECKLIST, TIPS } from '../../tips';
import { resetTutorial } from './coach';
import { btn, el, tag } from './dom';
import { isMuted, setMuted, sfx } from './sound';
import { HAS_SPRITES, mascot, sprite } from './sprites';

export class Modal {
  readonly el: HTMLElement;
  private box: HTMLElement;
  onChange: ((open: boolean) => void) | null = null;
  private locked = false;

  constructor() {
    this.el = el('div', 'g-modal');
    this.el.hidden = true;
    this.box = el('div', 'g-modal-box g-dlg');
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-modal', 'true');
    this.el.append(this.box);
    this.el.addEventListener('click', (ev) => { if (ev.target === this.el && !this.locked) this.close(); });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Show content; `locked` = no closing by clicking outside or Escape. */
  show(content: Node[], locked = false): void {
    this.locked = locked;
    this.box.replaceChildren(...content);
    if (this.el.hidden) sfx.ding();
    this.el.hidden = false;
    this.onChange?.(true);
    (this.box.querySelector('button.g-b-go, button') as HTMLButtonElement | null)?.focus();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.onChange?.(false);
  }

  escape(): void {
    if (!this.locked) this.close();
  }
}

const HOW: [string, string][] = [
  ['e-sunrise', 'Pick a landing spot by going to look. Does a ridge hide the Sun? Is Earth in view? How far is the ice?'],
  ['ice-rich', 'Pick a crater. Ice only lasts on floors the Sun never or barely reaches.'],
  ['i-remote', 'Rovers dig by themselves, but only while Earth is in view: people drive them by radio.'],
  ['i-plant', 'The plant turns ice into hydrogen and oxygen, but only with spare sunlight.'],
  ['stone', 'Leftover dry dirt builds landing pads (Earth sends a rover, tower or battery) and a shelter. Press Build in the dock whenever you have enough: no need to wait to be asked.'],
  ['star-on', 'Fill the capsule before the deadline. Keep the lights on. Pick well for the third star.'],
];

export function howTo(): HTMLElement {
  const ol = el('ol', 'g-how');
  for (const [g, t] of HOW) {
    const li = el('li');
    li.append(sprite(g, { scale: 2 }), el('span', '', t));
    ol.append(li);
  }
  return ol;
}

/** What makes a good landing spot and crater: the tutorial's lessons, kept for reference. */
export function spotChecklist(): HTMLElement {
  const box = el('div', 'g-checklist');
  box.append(el('p', 'g-kicker', 'Picking a good spot'));
  const ul = el('ul');
  for (const t of SPOT_CHECKLIST) ul.append(el('li', '', t));
  box.append(ul);
  return box;
}

export interface BriefInfo {
  siteName: string;
  daily: boolean;
  days: number;
  h2Kg: number;
  o2Kg: number;
  mods: Mods;
  resumeDay?: number;
}

/** The mission brief: the goal, the deadline, modifiers, and Start. */
export function briefPanel(b: BriefInfo, start: (mods: Mods) => void, extra: Node[] = []): Node[] {
  const out: Node[] = [];
  const head = el('div', 'g-brief-head');
  head.append(mascot('cheer'));
  const t = el('div');
  t.append(el('p', 'g-kicker', b.daily ? 'Daily mission' : 'Mission brief'), el('h2', 'g-h', b.siteName));
  head.append(t);
  out.push(head);
  out.push(el('p', 'g-lede', `Make rocket fuel from Moon ice and fill the sample capsule within ${b.days} days of landing.`));
  const mods = { ...b.mods };
  const box = el('fieldset', 'g-mods');
  const sw = (key: keyof Mods, name: string, help: string) => {
    const b2 = el('button', 'g-switch');
    b2.type = 'button';
    b2.setAttribute('role', 'switch');
    const paint = () => {
      b2.setAttribute('aria-checked', String(!!mods[key]));
      b2.replaceChildren(sprite(mods[key] ? 'switch-on' : 'switch-off', { scale: 2 }), el('span', 'g-switch-name', name), el('span', 'g-small', help));
    };
    b2.onclick = () => { mods[key] = !mods[key]; paint(); };
    paint();
    box.append(b2);
  };
  sw('trueScale', 'True scale', 'Hills at their real height: harder to read.');
  sw('noTimeline', 'No timeline', 'Read the 3D sky only.');
  sw('smallBattery', 'Small battery', 'Half the base battery.');
  const go = btn(b.resumeDay !== undefined ? `Continue: day ${b.resumeDay}` : 'Start mission', () => start(mods), 'go', 'arrow-r');
  go.classList.add('g-big');
  out.push(go, ...extra);
  if (b.resumeDay === undefined) {
    const how = el('details', 'g-fold');
    how.append(el('summary', '', 'How to play'), howTo(), spotChecklist());
    const hard = el('details', 'g-fold');
    hard.append(el('summary', '', 'Make it harder'), box);
    out.push(how, hard);
  }
  return out;
}

export interface ReportInfo {
  siteName: string;
  stars: number;
  launched: boolean;
  days: number | null;
  sleepHours: number;
  skySense: number | null;
  fillPct: number;
  nearMiss: string;
  improved: boolean;
  unlocked: string | null; // name of a site this result opened
  rank: string;
  totalStars: number;
}

const PATCH = ['patch-pine', 'patch-pine', 'patch-silver', 'patch-golden'];

export function reportPanel(r: ReportInfo, again: () => void, retry: () => void, map: () => void): Node[] {
  const out: Node[] = [];
  const head = el('div', 'g-report-head');
  head.append(sprite(PATCH[r.stars], { scale: 4, label: `${r.siteName} patch` }));
  const t = el('div');
  t.append(el('p', 'g-kicker', r.launched ? 'Capsule launched' : 'Deadline reached'), el('h2', 'g-h', r.siteName));
  const stars = el('div', 'g-stars');
  stars.setAttribute('aria-label', `${r.stars} of 3 stars`);
  for (let i = 0; i < 3; i++) stars.append(sprite(i < r.stars ? 'star-on' : 'star-off', { scale: 3, label: i < r.stars ? 'star' : 'no star' }));
  if (!HAS_SPRITES) stars.textContent = `${r.stars} of 3 stars`;
  t.append(stars);
  head.append(t);
  out.push(head);

  const list = el('ul', 'g-star-list');
  const line = (ok: boolean, title: string, detail: string) => {
    const li = el('li', ok ? 'ok' : '');
    li.append(sprite(ok ? 'i-check' : 'i-cross', { label: ok ? 'earned' : 'not earned' }), el('b', '', title), el('span', '', detail));
    list.append(li);
  };
  line(r.launched, 'Launch', r.launched ? `Tanks full on day ${Math.ceil(r.days ?? 0)}.` : `The capsule was ${r.fillPct}% full at the deadline.`);
  line(r.stars >= 2, 'Lights on', `The base slept ${Math.round(r.sleepHours)} h (2 days or less earns it).`);
  line(r.stars >= 3, 'Sky Sense', r.skySense === null ? 'No choices scored.' : `Your picks scored ${r.skySense} (80 earns it).`);
  out.push(list);

  const nm = el('div', 'g-nearmiss');
  nm.append(mascot('sad'), el('p', '', r.nearMiss));
  if (r.stars === 3) nm.firstElementChild?.replaceWith(mascot('love'));
  out.push(nm);
  if (r.unlocked) out.push(el('p', 'g-unlock', `New site open: ${r.unlocked}.`));
  out.push(el('p', 'g-small', `${r.rank} · ${r.totalStars} stars in all${r.improved ? ' · new best for this site' : ''}`));
  const go = btn('Another mission', again, 'go', 'arrow-r');
  go.classList.add('g-big');
  const row = el('div', 'g-row');
  row.append(btn('Same start again', retry, 'plate'), btn('Moon map', map, 'plate'));
  out.push(go, row);
  return out;
}

export interface MenuActions {
  log: string[];
  resume(): void;
  restart(): void;
  explore(): void;
  sites(): void;
  rank: string;
  stars: number;
}

export function menuPanel(m: MenuActions, show: (nodes: Node[]) => void): Node[] {
  const back = () => show(menuPanel(m, show));
  const head = el('div', 'g-brief-head g-menu-head');
  head.append(sprite('i-crown', { scale: 2 }));
  const t = el('div');
  t.append(el('p', 'g-kicker', 'Menu'), el('h2', 'g-h', `${m.rank} · ${m.stars} stars`));
  const sound = btn(isMuted() ? 'Sound: off' : 'Sound: on', () => { setMuted(!isMuted()); back(); }, 'sq');
  sound.classList.add('g-menu-sound');
  head.append(t, sound);
  const go = btn('Keep playing', m.resume, 'go', 'arrow-r');
  go.classList.add('g-big');
  const row = el('div', 'g-menu-row');
  row.append(
    btn('Moon map', m.sites, 'plate', 'i-home'),
    btn('Explore', m.explore, 'plate', 'i-remote'),
    btn('Start over', () => show([el('h2', 'g-h', 'Start a new run?'), el('p', '', 'This run ends without a result.'), btn('Start over', m.restart, 'go'), btn('Cancel', back, 'plate')]), 'plate', 'i-skull'),
  );
  const replay = () => { resetTutorial(); m.restart(); };
  return [head, go, btn('Guide & facts', () => show(guidePage(m.log, back, replay)), 'plate', 'i-question'), row];
}

/** Everything to read, on one page of folds: how to play, the radio log, facts, sources, credits. */
function guidePage(log: string[], back: () => void, replay: () => void): Node[] {
  const fold = (title: string, kids: Node[], open = false) => {
    const d = el('details', 'g-fold');
    d.open = open;
    d.append(el('summary', '', title), ...kids);
    return d;
  };
  const ol = el('ol', 'g-log');
  for (const line of log) ol.append(el('li', '', line));
  if (!log.length) ol.append(el('li', '', 'No messages yet.'));
  return [
    el('h2', 'g-h', 'Guide & facts'),
    fold('How to play', [howTo(), spotChecklist(), btn('Replay tutorial (starts a new run)', replay, 'plate', 'i-question')], true),
    fold('Radio log', [ol]),
    fold('Moon facts', factsPage()),
    fold('What\'s real', realPage()),
    fold('Credits', creditsPage()),
    btn('Back', back, 'plate', 'arrow-l'),
  ];
}

function factsPage(): Node[] {
  const out: Node[] = [];
  const add = (title: string, text: string, t?: Parameters<typeof tag>[0], source?: string) => {
    const d = el('details', 'g-fact');
    const s = el('summary');
    s.append(el('span', '', title));
    if (t) s.append(tag(t));
    d.append(s, el('p', '', text));
    if (source) d.append(el('p', 'g-small', `Source: ${source}`));
    out.push(d);
  };
  add('Power and contact', TIPS.power);
  add('Earth in the Moon\'s sky', TIPS.earth);
  add('The timeline', TIPS.timeline);
  add('Water ice', TIPS.ice);
  add('Rover batteries', TIPS.battery);
  for (const f of Object.values(FACTS)) add(f.title, f.text, f.tag, f.source);
  add('What this game leaves out', NOT_MODELLED);
  return out;
}

const REAL_ROWS: [string, Parameters<typeof tag>[0]][] = [
  ['Sun and Earth positions, every hour of 2027 (SPICE)', 'REAL'],
  ['Terrain and horizons (NASA LOLA)', 'REAL'],
  ['% sunlit, % Earth, longest night, crater floor sunlight', 'REAL'],
  ['Water splits into 11% hydrogen, 89% oxygen', 'REAL'],
  ['Capsule fuel (rocket equation), tower power, rover speed (VIPER)', 'ESTIMATE'],
  ['Projected launch day (the game rules replayed on the real sky)', 'ESTIMATE'],
  ['Rich / trace / no ice by how dark a floor is; the 5% cut-off', 'RULE'],
  ['How much ice each crater holds (inside the LCROSS range)', 'HYPOTHETICAL'],
  ['Pads, deliveries, shelter, battery packs, rover loads', 'HYPOTHETICAL'],
  ['The base sleeping when its battery is empty', 'RULE'],
];

function realPage(): Node[] {
  const t = el('table', 'g-real');
  for (const [what, tg] of REAL_ROWS) {
    const tr = el('tr');
    const td = el('td');
    td.append(tag(tg));
    tr.append(el('td', '', what), td);
    t.append(tr);
  }
  return [
    el('p', '', 'Numbers come from the horizon math, not from the 3D picture. If the two ever disagree, the numbers win.'),
    t,
  ];
}

function creditsPage(): Node[] {
  const a = el('a', '', 'cupnooble.itch.io');
  a.href = 'https://cupnooble.itch.io';
  a.target = '_blank';
  a.rel = 'noopener';
  const p = el('p');
  p.append('Assets from Sprout Lands by Cup Nooble (UI pack, sprites and the Sorry pack: frames, icons, chests, sounds), recoloured for space. ', a);
  return [
    p,
    el('p', 'g-small', 'The packs may not be redistributed, so they are not in this project. `npm run skin` builds the art from your own download; without it the game uses plain frames and words.'),
    el('p', '', 'Terrain: NASA LRO LOLA. Sun and Earth: NASA/NAIF SPICE.'),
  ];
}

export function lockedPanel(siteName: string, need: number, map: () => void): Node[] {
  const head = el('div', 'g-brief-head');
  head.append(sprite('i-lock', { scale: 3 }));
  const t = el('div');
  t.append(el('p', 'g-kicker', 'Locked'), el('h2', 'g-h', siteName));
  head.append(t);
  return [head, el('p', 'g-lede', `Earn ${need} more star${need === 1 ? '' : 's'} at the open sites to fly here.`), btn('Moon map', map, 'go', 'arrow-l')];
}
