// The instruments (game.MD v3 §7): ONE compact dock along the bottom, beside
// mission control and the timeline, so the 3D view keeps the rest of the
// screen. Readings are glyphs and short meters; details live in tooltips, and
// at most one warning shows at a time. The dirt pile and the Build button sit
// together right after Fuel, always shown once landed, so building reads as
// something you can do any time; its tray pops up above the button. The map
// always sits in the top-right corner.

import { btn, el, kg, meter, type Meter } from './dom';
import { sprite } from './sprites';
import { BUILD_ITEMS, type BuildItem } from '../sim';

/** Name and icon of each thing the dry dirt can build. */
export const BUILD_INFO: Record<BuildItem, { name: string; glyph: string }> = {
  pad: { name: 'Landing pad', glyph: 'crate' },
  shelter: { name: 'Dirt cover', glyph: 'i-home' },
  roads: { name: 'Packed roads', glyph: 'e-dirt' },
  oven: { name: 'Dirt-lined oven', glyph: 'fire' },
};

export interface RoverView {
  id: number;
  word: string; // "digging", "waiting for Earth", ...
  charge: number; // 0..1
  stuck: boolean; // waiting on Earth or power
}

export interface BuildView {
  item: BuildItem;
  built: boolean;
  cost: number | null;
  can: boolean;
}

export interface HudView {
  landed: boolean;
  day: number;
  days: number;
  date: string;
  h2: number; // 0..1
  o2: number;
  h2Kg: number;
  o2Kg: number;
  battery: number; // 0..1
  batteryKWh: number;
  sun: boolean;
  asleep: boolean;
  earth: boolean;
  sunFlipH: number | null; // hours until the Sun rises / sets at the base
  earthFlipH: number | null; // hours until Earth rises / sets
  rovers: RoverView[];
  dirtKg: number;
  builds: BuildView[];
  nextCost: number | null; // the cheapest build still open, for the dirt meter
  deliveries: number;
  towers: number;
}

export interface HudHandlers {
  menu(): void;
  build(item: BuildItem): void;
  togglePlay(): void;
  speed(hoursPerSec: number): void;
}

export const SPEEDS = [
  { h: 24, label: '1 day/s' },
  { h: 72, label: '3 days/s' },
];

const inWords = (h: number | null) => (h === null ? '' : h >= 36 ? `${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h`);

export class Hud {
  readonly el: HTMLElement;
  readonly mapSlot: HTMLElement;
  private fuel: Meter;
  private batt: Meter;
  private q: <T extends HTMLElement = HTMLElement>(s: string) => T;
  private playBtn: HTMLButtonElement;
  private speedBtn: HTMLButtonElement;
  private tray: HTMLElement;
  private dirt: Meter;
  private buildBox: HTMLElement;
  private nudgeTimer = 0;
  private speedH = SPEEDS[0].h;

  constructor(on: HudHandlers) {
    const root = el('div', 'g-hud');
    this.el = root;
    this.q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

    // One dock at the bottom, next to mission control and the timeline.
    const bar = el('div', 'g-bar g-dlg');
    const stat = (cls: string, ...kids: Node[]) => {
      const s = el('div', `g-stat ${cls}`);
      s.append(...kids);
      return s;
    };
    const group = (...kids: Node[]) => {
      const g = el('div', 'g-group');
      g.append(...kids);
      return g;
    };

    const menu = btn('Menu', on.menu, 'sq', 'i-gear');

    this.fuel = meter(10, 'blue', 'Capsule fuel');
    const fuel = stat('g-fuel', el('span', 'g-k', 'Fuel'), this.fuel.el, el('b', 'g-fuel-pct'));

    this.batt = meter(6, 'green', 'Base battery');
    const sunG = el('span', 'g-sun-glyph');
    sunG.append(sprite('w-day', { label: 'Sun up', cls: 'when-on' }), sprite('w-night', { label: 'Night', cls: 'when-off' }));
    const power = stat('g-power', sunG, this.batt.el);
    const earth = stat('g-link', sprite('earth', { label: 'Earth' }));
    // At most one warning at a time: the most urgent one.
    const alert = stat('g-alert', sprite('i-alert'), el('span', 'g-v g-alert-word'));

    const day = stat('g-day', el('b', 'g-day-n'));

    this.playBtn = btn('Play', on.togglePlay, 'sq', 'arrow-r');
    this.playBtn.classList.add('g-play');
    this.speedBtn = btn(SPEEDS[0].label, () => {
      const i = SPEEDS.findIndex((s) => s.h === this.speedH);
      on.speed(SPEEDS[(i + 1) % SPEEDS.length].h);
    }, 'sq');
    this.speedBtn.classList.add('g-speed');

    // Dry dirt and what it builds, side by side: Build is always there once landed.
    this.dirt = meter(6, 'sun', 'Dry dirt toward the next build');
    const dirt = stat('g-dirt', el('span', 'g-k', 'Dirt'), this.dirt.el, el('b', 'g-dirt-n'));
    const buildBtn = btn('Build', () => { this.tray.hidden = !this.tray.hidden; }, 'sq', 'stone');
    buildBtn.classList.add('g-build-btn');
    buildBtn.title = 'Build with dry dirt any time. The clock keeps running.';

    // The tray pops up right above the Build button.
    this.tray = el('div', 'g-pop g-tray g-dlg');
    this.tray.hidden = true;
    this.tray.setAttribute('aria-label', 'Build with dry dirt');
    this.tray.append(el('span', 'g-dirt-kg'));
    this.buildBox = group(dirt, buildBtn, this.tray);
    this.buildBox.classList.add('g-build');

    bar.append(
      group(menu),
      group(fuel),
      this.buildBox,
      group(power, earth, alert),
      group(day, this.playBtn, this.speedBtn),
    );

    // A click anywhere else, or Esc, folds the tray away.
    document.addEventListener('pointerdown', (ev) => {
      if (!this.tray.hidden && !this.buildBox.contains(ev.target as Node)) this.tray.hidden = true;
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') this.tray.hidden = true; });

    for (const item of BUILD_ITEMS) {
      const b = btn(BUILD_INFO[item].name, () => { this.tray.hidden = true; on.build(item); }, 'sq', BUILD_INFO[item].glyph);
      b.classList.add('g-slot', `g-slot-${item}`);
      b.append(el('span', 'g-slot-cost'));
      this.tray.append(b);
    }
    // The map stays in the top-right corner the whole time.
    this.mapSlot = el('div', 'g-mapbox g-dlg');
    this.mapSlot.setAttribute('aria-label', 'Map');

    root.append(bar, this.mapSlot);
  }

  /** Draw the eye to the Build button for a few seconds (after a tip or a build offer). */
  nudgeBuild(): void {
    const b = this.q('.g-build-btn');
    b.classList.remove('nudge');
    void b.offsetWidth; // restart the animation
    b.classList.add('nudge');
    window.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => b.classList.remove('nudge'), 3200);
  }

  /** Fold the build tray away (a panel or a radio line is taking over). */
  closeTray(): void {
    this.tray.hidden = true;
  }

  setClock(playing: boolean, hoursPerSec: number, slowed: boolean): void {
    this.speedH = hoursPerSec;
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.playBtn.title = playing ? 'Pause (space)' : 'Play (space)';
    this.playBtn.classList.toggle('on', playing);
    if (this.playBtn.dataset.playing !== String(playing)) {
      this.playBtn.dataset.playing = String(playing);
      this.playBtn.replaceChildren(playing ? el('span', 'g-pause') : sprite('arrow-r'), el('span', 'g-b-label', playing ? 'Pause' : 'Play'));
    }
    const label = slowed ? 'auto-slow' : SPEEDS.find((s) => s.h === hoursPerSec)?.label ?? '';
    this.speedBtn.querySelector('.g-b-label')!.textContent = label;
    this.speedBtn.title = slowed ? 'Slowed down by itself around a sunrise, sunset or Earthset. Click to change speed.' : 'Change speed';
    this.el.classList.toggle('slowed', slowed);
  }

  update(v: HudView): void {
    this.el.classList.toggle('landed', v.landed);
    const fill = Math.min(1, v.h2, v.o2);
    this.fuel.set(fill);
    this.q('.g-fuel-pct').textContent = `${Math.floor(fill * 100)}%`;
    this.q('.g-fuel').title = `Capsule fuel: ${kg(v.h2Kg)} of 19 kg hydrogen, ${kg(v.o2Kg)} of 114 kg oxygen`;

    // Power and Earth: icons only; the words live in the tooltips.
    this.batt.set(v.battery, v.asleep ? 'red' : v.battery < 0.25 ? 'sun' : 'green');
    this.q('.g-sun-glyph').classList.toggle('on', v.sun);
    this.q('.g-power').title = `${v.sun ? 'Sun up' : 'Night'} · base battery ${Math.round(v.battery * 100)}%${v.sunFlipH !== null ? ` · ${v.sun ? 'sunset' : 'sunrise'} in ${inWords(v.sunFlipH)}` : ''}`;
    this.q('.g-link').classList.toggle('off', !v.earth);
    const roverLines = v.rovers.map((r) => `Rover ${r.id}: ${r.word}, battery ${Math.round(r.charge * 100)}%`);
    this.q('.g-link').title = [
      v.earth ? `Earth in view: rovers can drive${v.earthFlipH !== null ? ` · sets in ${inWords(v.earthFlipH)}` : ''}` : `Earth hidden: rovers wait${v.earthFlipH !== null ? ` · back in ${inWords(v.earthFlipH)}` : ''}`,
      ...roverLines,
    ].join('\n');

    // The one warning: base asleep > Earth hidden > all rovers stuck.
    const stuck = v.rovers.filter((r) => r.stuck);
    const allStuck = v.rovers.length > 0 && stuck.length === v.rovers.length;
    let alert = '';
    let why = '';
    if (!v.landed) alert = '';
    else if (v.asleep) {
      alert = `Asleep${v.sunFlipH !== null && !v.sun ? ` · sun in ${inWords(v.sunFlipH)}` : ''}`;
      why = 'The base battery is empty. It wakes when the Sun comes back.';
    } else if (!v.earth) {
      alert = `No Earth${v.earthFlipH !== null ? ` · ${inWords(v.earthFlipH)}` : ''}`;
      why = 'Earth is below the horizon, so nobody can drive the rovers.';
    } else if (allStuck) {
      alert = `Rovers ${stuck[0].word.split(/[:.,]/)[0].replace(/^rover\s+/i, '')}`;
      why = roverLines.join('\n');
    }
    this.q('.g-alert').hidden = !alert;
    this.q('.g-alert-word').textContent = alert;
    this.q('.g-alert').title = why;

    // Build: always shown once landed; it lights up when the dirt pays for something.
    let any = false;
    for (const b of v.builds) {
      const slot = this.q<HTMLButtonElement>(`.g-slot-${b.item}`);
      const built = b.built;
      slot.disabled = !b.can;
      any ||= b.can;
      slot.classList.toggle('built', built);
      slot.querySelector('.g-slot-cost')!.textContent = built ? 'built'
        : b.cost === null ? 'not now'
        : v.dirtKg >= b.cost ? `${b.cost} kg`
        : `need ${kg(b.cost - v.dirtKg)} more`;
    }
    this.dirt.set(v.nextCost ? v.dirtKg / v.nextCost : 0, any ? 'sun' : 'purple');
    this.q('.g-dirt-n').textContent = kg(v.dirtKg);
    this.q('.g-dirt').title = v.nextCost === null ? `${kg(v.dirtKg)} of dry dirt left over from the plant`
      : any ? `${kg(v.dirtKg)} of dry dirt: enough to build. Press Build.`
      : `${kg(v.dirtKg)} of dry dirt · next build at ${kg(v.nextCost)}`;
    this.q('.g-dirt-kg').textContent = `Build any time · ${kg(v.dirtKg)} dry dirt`;
    const bb = this.q('.g-build-btn');
    bb.classList.toggle('ready', any);
    bb.querySelector('.g-b-label')!.textContent = any ? 'Build!' : 'Build';

    this.q('.g-day-n').textContent = v.landed ? `Day ${v.day}/${v.days}` : 'Not landed';
    this.q('.g-day').title = v.date;
  }
}
