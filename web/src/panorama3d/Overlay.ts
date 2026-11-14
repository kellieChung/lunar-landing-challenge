// HTML overlay on the 3D view: a compass strip along the top (degree ticks,
// N/E/S/W, Sun and Earth markers, arrows when they are off-screen) and
// constant-size markers pinned to the Sun and Earth so the true-size disks are
// easy to find. "Hidden" comes from the physics; the overlay only shows it.

import { azToScreenX } from './mapping';

export interface OverlayBody {
  az: number; // deg, site frame
  screen: { x: number; y: number; inFront: boolean }; // normalized device coords of the drawn disk
  hidden: boolean; // physics: behind terrain
}

export interface OverlayView {
  yaw: number;
  hfov: number;
  sun: OverlayBody;
  earth: OverlayBody;
}

const TICK_STEP = 15;
const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

type BodyKey = 'sun' | 'earth';
const NAMES: Record<BodyKey, string> = { sun: 'Sun', earth: 'Earth' };
const ICONS: Record<BodyKey, string> = { sun: '☀', earth: '◐' };

export class Overlay {
  private root: HTMLElement;
  private strip: HTMLElement;
  private ticks: HTMLElement[] = [];
  private stripMarks = {} as Record<BodyKey, HTMLElement>;
  private arrows = {} as Record<BodyKey, HTMLButtonElement>;
  private pins = {} as Record<BodyKey, HTMLElement>;

  /** onTurn(az): an off-screen arrow was clicked; turn the view to that azimuth. */
  constructor(stage: HTMLElement, private onTurn: (az: number) => void) {
    this.root = document.createElement('div');
    this.root.className = 'ov';
    this.strip = document.createElement('div');
    this.strip.className = 'ov-compass';
    this.strip.setAttribute('aria-hidden', 'true');
    for (let az = 0; az < 360; az += TICK_STEP) {
      const t = document.createElement('span');
      t.className = CARDINALS[az] ? 'ov-tick ov-cardinal' : 'ov-tick';
      t.textContent = CARDINALS[az] ?? String(az);
      this.ticks.push(t);
      this.strip.append(t);
    }
    this.root.append(this.strip);

    for (const key of ['sun', 'earth'] as BodyKey[]) {
      const mark = document.createElement('span');
      mark.className = `ov-strip-mark ov-${key}`;
      mark.textContent = ICONS[key];
      this.strip.append(mark);
      this.stripMarks[key] = mark;

      const arrow = document.createElement('button');
      arrow.type = 'button';
      arrow.className = `ov-arrow ov-${key}`;
      this.root.append(arrow);
      this.arrows[key] = arrow;

      const pin = document.createElement('div');
      pin.className = `ov-pin ov-${key}`;
      pin.innerHTML = '<span class="ov-ring"></span><span class="ov-label"></span>';
      this.root.append(pin);
      this.pins[key] = pin;
    }
    stage.append(this.root);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  update(v: OverlayView): void {
    const pct = (x: number) => `${((x + 1) / 2) * 100}%`;
    this.ticks.forEach((t, i) => {
      const { x, side } = azToScreenX(i * TICK_STEP, v.yaw, v.hfov);
      t.hidden = side !== 0;
      if (side === 0) t.style.left = pct(x);
    });
    for (const key of ['sun', 'earth'] as BodyKey[]) this.updateBody(key, v[key], v, pct);
  }

  private updateBody(key: BodyKey, b: OverlayBody, v: OverlayView, pct: (x: number) => string): void {
    const { x, side } = azToScreenX(b.az, v.yaw, v.hfov);
    const name = NAMES[key];
    const state = b.hidden ? 'behind terrain' : 'in view';

    const mark = this.stripMarks[key];
    mark.hidden = side !== 0;
    mark.classList.toggle('hidden-body', b.hidden);
    if (side === 0) mark.style.left = pct(x);

    const arrow = this.arrows[key];
    arrow.hidden = side === 0;
    if (side !== 0) {
      const turn = Math.round(Math.abs(((b.az - v.yaw + 540) % 360) - 180));
      arrow.textContent = side < 0 ? `◀ ${ICONS[key]} ${name} ${turn}°` : `${name} ${ICONS[key]} ${turn}° ▶`;
      arrow.classList.toggle('left', side < 0);
      arrow.classList.toggle('right', side > 0);
      arrow.classList.toggle('hidden-body', b.hidden);
      arrow.title = `${name} is ${turn}° to the ${side < 0 ? 'left' : 'right'} (${state}). Click to turn.`;
      arrow.onclick = () => this.onTurn(b.az);
    }

    const pin = this.pins[key];
    const s = b.screen;
    const onScreen = s.inFront && Math.abs(s.x) <= 1.05 && Math.abs(s.y) <= 1.05;
    pin.hidden = !onScreen;
    if (onScreen) {
      pin.style.left = pct(s.x);
      pin.style.top = `${((1 - s.y) / 2) * 100}%`;
      pin.classList.toggle('hidden-body', b.hidden);
      pin.querySelector('.ov-label')!.textContent = b.hidden ? `${name} · behind terrain` : name;
    }
  }
}
