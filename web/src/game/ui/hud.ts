// The instruments (game.MD v3 §7): ONE thin status bar along the top, so the
// 3D view keeps the whole screen. Each reading is a glyph, a short meter or a
// number and at most a few words; details live in tooltips. The build tray
// and the map open as small pop-overs under the bar only when asked for.

import { btn, el, kg, meter, type Meter } from './dom';
import { sprite } from './sprites';

export interface RoverView {
  id: number;
  word: string; // "digging", "waiting for Earth", ...
  charge: number; // 0..1
  stuck: boolean; // waiting on Earth or power
}

export interface BuildView {
  item: 'pad' | 'shelter';
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
  deliveries: number;
  shelter: boolean;
  towers: number;
}

export interface HudHandlers {
  menu(): void;
  map(): void;
  build(item: 'pad' | 'shelter'): void;
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
  private speedH = SPEEDS[0].h;

  constructor(on: HudHandlers) {
    const root = el('div', 'g-hud');
    this.el = root;
    this.q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

    const bar = el('div', 'g-bar g-dlg');
    const stat = (cls: string, ...kids: Node[]) => {
      const s = el('div', `g-stat ${cls}`);
      s.append(...kids);
      return s;
    };

    const menu = btn('Menu', on.menu, 'sq', 'i-gear');

    this.fuel = meter(10, 'blue', 'Capsule fuel');
    const fuel = stat('g-fuel', el('span', 'g-k', 'Capsule fuel'), this.fuel.el, el('b', 'g-fuel-pct'));

    this.batt = meter(6, 'green', 'Base battery');
    const sunG = el('span', 'g-sun-glyph');
    sunG.append(sprite('w-day', { label: 'Sun up', cls: 'when-on' }), sprite('w-night', { label: 'Night', cls: 'when-off' }));
    const power = stat('g-power', sunG, this.batt.el, el('span', 'g-v g-power-word'));

    const earth = stat('g-link', sprite('earth', { label: 'Earth' }), el('span', 'g-v g-link-word'));

    const rovers = stat('g-rov', sprite('i-remote', { label: 'Rovers' }), el('b', 'g-rov-n'), el('span', 'g-v g-rov-word'));

    const buildBtn = btn('Build', () => { this.tray.hidden = !this.tray.hidden; }, 'go');
    buildBtn.classList.add('g-build-btn');
    const dirt = stat('g-dirt', sprite('stone', { label: 'Dry dirt' }), el('b', 'g-dirt-kg'), buildBtn);

    const day = stat('g-day', el('b', 'g-day-n'), el('span', 'g-date'));

    this.playBtn = btn('Play', on.togglePlay, 'sq', 'arrow-r');
    this.playBtn.classList.add('g-play');
    this.speedBtn = btn(SPEEDS[0].label, () => {
      const i = SPEEDS.findIndex((s) => s.h === this.speedH);
      on.speed(SPEEDS[(i + 1) % SPEEDS.length].h);
    }, 'sq');
    this.speedBtn.classList.add('g-speed');
    const clock = stat('g-clock', this.playBtn, this.speedBtn);

    const map = btn('Map', on.map, 'sq', 'i-home');
    map.classList.add('g-map-btn');

    bar.append(menu, fuel, power, earth, rovers, dirt, el('span', 'g-gap'), day, clock, map);

    // Pop-overs under the bar, shown on request.
    this.tray = el('div', 'g-pop g-tray g-dlg');
    this.tray.hidden = true;
    this.tray.setAttribute('aria-label', 'Build with dry dirt');
    for (const item of ['pad', 'shelter'] as const) {
      const b = btn(item === 'pad' ? 'Landing pad' : 'Shelter', () => { this.tray.hidden = true; on.build(item); }, 'sq', item === 'pad' ? 'crate' : 'fire');
      b.classList.add('g-slot', `g-slot-${item}`);
      b.append(el('span', 'g-slot-cost'));
      this.tray.append(b);
    }
    this.mapSlot = el('div', 'g-pop g-mapbox g-dlg');
    this.mapSlot.hidden = true;

    root.append(bar, this.tray, this.mapSlot);
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
    this.q('.g-fuel').title = `Capsule: ${kg(v.h2Kg)} of 19 kg hydrogen, ${kg(v.o2Kg)} of 114 kg oxygen`;

    // Power: the glyph and meter always; words only when the base is asleep or the Sun changes within a day.
    this.batt.set(v.battery, v.asleep ? 'red' : v.battery < 0.25 ? 'sun' : 'green');
    this.q('.g-sun-glyph').classList.toggle('on', v.sun);
    const soon = v.sunFlipH !== null && v.sunFlipH <= 24;
    this.q('.g-power-word').textContent = v.asleep
      ? `Base asleep${v.sunFlipH !== null && !v.sun ? `: sunrise in ${inWords(v.sunFlipH)}` : ''}`
      : soon ? (v.sun ? `Sunset in ${inWords(v.sunFlipH)}` : `Sunrise in ${inWords(v.sunFlipH)}`) : '';
    this.q('.g-power').classList.toggle('alert', v.asleep);
    this.q('.g-power').title = `${v.sun ? 'Sun up' : 'Night'} · base battery ${Math.round(v.battery * 100)}%${v.sunFlipH !== null ? ` · ${v.sun ? 'sunset' : 'sunrise'} in ${inWords(v.sunFlipH)}` : ''}`;

    // Earth: the glyph always; words only when Earth is hidden or about to set.
    const eSoon = v.earth && v.earthFlipH !== null && v.earthFlipH <= 24;
    this.q('.g-link').classList.toggle('off', !v.earth);
    this.q('.g-link-word').textContent = !v.earth
      ? `Earth hidden${v.earthFlipH !== null ? `: back in ${inWords(v.earthFlipH)}` : ''}`
      : eSoon ? `Earth sets in ${inWords(v.earthFlipH)}` : '';
    this.q('.g-link').classList.toggle('alert', !v.earth && v.landed);
    this.q('.g-link').title = v.earth ? `Earth in view: rovers can drive${v.earthFlipH !== null ? ` · sets in ${inWords(v.earthFlipH)}` : ''}` : 'Earth hidden: rovers wait';

    // Rovers: only when they are all stuck.
    const stuck = v.rovers.filter((r) => r.stuck);
    const allStuck = v.rovers.length > 0 && stuck.length === v.rovers.length;
    this.q('.g-rov').hidden = !allStuck;
    this.q('.g-rov-n').textContent = '';
    this.q('.g-rov-word').textContent = allStuck ? `Rovers ${stuck[0].word.split(':')[0]}` : '';
    this.q('.g-rov').classList.toggle('alert', allStuck);
    this.q('.g-rov').title = v.rovers.map((r) => `Rover ${r.id}: ${r.word}, battery ${Math.round(r.charge * 100)}%`).join('\n');

    // Dirt and Build: only when something is affordable.
    let any = false;
    for (const b of v.builds) {
      const slot = this.q<HTMLButtonElement>(`.g-slot-${b.item}`);
      const built = b.item === 'shelter' && v.shelter;
      slot.disabled = !b.can;
      any ||= b.can;
      slot.classList.toggle('built', built);
      slot.querySelector('.g-slot-cost')!.textContent = built ? 'built' : b.cost === null ? '' : `${b.cost} kg`;
    }
    this.q('.g-dirt-kg').textContent = `${kg(v.dirtKg)} dirt`;
    this.q('.g-dirt').hidden = !any;
    if (!any) this.tray.hidden = true;

    this.q('.g-day-n').textContent = v.landed ? `Day ${v.day} of ${v.days}` : 'Not landed';
    this.q('.g-date').textContent = v.date;
  }
}
