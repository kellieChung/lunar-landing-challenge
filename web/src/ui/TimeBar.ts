// Time controls under the panorama: a full-year strip (click to jump), a
// 30-day track colored by state with a native range slider on top, play /
// pause, speed, and "next sunrise" / "next Earthrise" jumps.
// Owns the clock; tells the site screen about every change through hooks.

import type { SiteSeries } from '../physics/metrics';
import { sampleDate } from '../physics/time';
import { timelineSprites } from '../skin';

export const PAGE_SAMPLES = 720; // 30 days of hourly samples
const SPEEDS = [
  { daysPerSec: 1, label: '1 d/s' },
  { daysPerSec: 1.5, label: '1.5 d/s' }, // a month in ~20 s
  { daysPerSec: 7, label: '1 wk/s' },
];
const DEFAULT_SPEED = 1;
const MAX_FRAME_S = 0.1; // don't leap ahead after a stalled frame

export type JumpKind = 'sunrise' | 'earthrise';

export interface TimeBarHooks {
  /** Every change of time: drag, play frame, jump. */
  onTime(t: number): void;
  /** Time came to rest (pause, jump, end of a drag). */
  onSettle(t: number): void;
  /** Time of the next event after t, or null if none before the data ends. */
  nextEvent(kind: JumpKind, t: number): number | null;
  /** After a jump button moved the time (e.g. turn the view to the Sun). */
  onJump?(kind: JumpKind): void;
}

/** Color names per state; CSS variables give the actual colors. */
const SPRITE_W = 28; // timeline bar sprites: 28 x 14, 4 px end caps
const SPRITE_H = 14;
const SPRITE_CAP = 4;
let spriteImgs: HTMLImageElement[] | null = null;
let spritesReady = false;
const spriteWaiters = new Set<() => void>();

/** Loads the bar sprites once; `onReady` fires when they can be drawn. */
function loadSprites(onReady: () => void): HTMLImageElement[] | null {
  if (!timelineSprites) return null;
  if (!spriteImgs) {
    let left = timelineSprites.length;
    spriteImgs = timelineSprites.map((url) => {
      const img = new Image();
      img.onload = () => {
        if (--left === 0) {
          spritesReady = true;
          spriteWaiters.forEach((f) => f());
        }
      };
      img.src = url;
      return img;
    });
  }
  if (!spritesReady) spriteWaiters.add(onReady);
  return spritesReady ? spriteImgs : null;
}

const STATE_VARS = ['--none', '--sun', '--earth', '--both'];

function stateIndex(s: SiteSeries, i: number): number {
  return s.lit[i] | (s.earth[i] << 1); // 0 none, 1 Sun, 2 Earth, 3 both
}

/** First sample of the 30-day page that contains t. */
export function pageStart(t: number, count: number): number {
  const p = Math.floor(t / PAGE_SAMPLES) * PAGE_SAMPLES;
  return Math.max(0, Math.min(p, count - PAGE_SAMPLES));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatUtc(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

const TEMPLATE = `
  <div class="tb-row tb-top">
    <button type="button" class="tb-play" aria-label="Play">▶</button>
    <div class="seg tb-speed" role="group" aria-label="Playback speed"></div>
    <div class="tb-when"><span class="tb-date"></span><span class="tb-day"></span></div>
    <div class="tb-jumps">
      <button type="button" class="tb-jump" data-kind="sunrise">Next sunrise ▸</button>
      <button type="button" class="tb-jump" data-kind="earthrise">Next Earthrise ▸</button>
    </div>
  </div>
  <div class="tb-year" title="All of 2027: click to jump">
    <canvas class="tb-year-canvas" aria-hidden="true"></canvas>
    <div class="tb-page" aria-hidden="true"></div>
    <div class="tb-year-head" aria-hidden="true"></div>
  </div>
  <div class="tb-months" aria-hidden="true"></div>
  <div class="tb-track">
    <canvas class="tb-track-canvas" aria-hidden="true"></canvas>
    <input type="range" class="tb-range" step="1" aria-label="Time within these 30 days (hours)" />
  </div>
  <div class="tb-row tb-bottom">
    <div class="tb-ticks" aria-hidden="true"></div>
  </div>
  <ul class="tb-legend">
    <li><i style="background:var(--both)"></i>Sun + Earth</li>
    <li><i style="background:var(--sun)"></i>Sun only</li>
    <li><i style="background:var(--earth)"></i>Earth only</li>
    <li><i style="background:var(--none)"></i>Dark, no Earth</li>
  </ul>`;

export class TimeBar {
  private t = 0;
  private page = -1;
  private playing = false;
  private speed = SPEEDS[DEFAULT_SPEED].daysPerSec;
  private frame = 0;
  private lastFrameMs = 0;
  private readonly count: number;

  private el<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }
  private playBtn: HTMLButtonElement;
  private range: HTMLInputElement;
  private yearCanvas: HTMLCanvasElement;
  private trackCanvas: HTMLCanvasElement;
  private pageBox: HTMLElement;
  private yearHead: HTMLElement;

  constructor(
    private root: HTMLElement,
    private series: SiteSeries,
    private startIso: string,
    private stepHours: number,
    private hooks: TimeBarHooks,
  ) {
    this.count = series.count;
    root.innerHTML = TEMPLATE;
    this.playBtn = this.el('.tb-play');
    this.range = this.el('.tb-range');
    this.yearCanvas = this.el('.tb-year-canvas');
    this.trackCanvas = this.el('.tb-track-canvas');
    this.pageBox = this.el('.tb-page');
    this.yearHead = this.el('.tb-year-head');

    this.buildSpeedButtons();
    this.buildMonthLabels();
    this.playBtn.onclick = () => this.setPlaying(!this.playing);
    for (const b of root.querySelectorAll<HTMLButtonElement>('.tb-jump')) {
      b.onclick = () => this.jump(b.dataset.kind as JumpKind);
    }
    this.range.addEventListener('input', () => {
      this.setPlaying(false, false);
      this.seek(Number(this.range.value), false);
    });
    this.range.addEventListener('change', () => this.hooks.onSettle(this.t));
    this.attachYearDrag();
    document.addEventListener('keydown', (ev) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (ev.key !== ' ' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || this.root.offsetParent === null) return;
      ev.preventDefault();
      this.setPlaying(!this.playing);
    });
    new ResizeObserver(() => this.drawAll()).observe(root);
  }

  get time(): number {
    return this.t;
  }

  /** Move to time t (sample index) and notify. */
  seek(t: number, settle = true): void {
    this.t = Math.min(Math.max(t, 0), this.count - 1);
    const p = pageStart(this.t, this.count);
    if (p !== this.page) {
      this.page = p;
      this.range.min = String(p);
      this.range.max = String(Math.min(p + PAGE_SAMPLES, this.count - 1));
      this.drawTrack();
      this.drawTicks();
      this.placePageBox();
    }
    this.range.value = String(this.t);
    this.range.setAttribute('aria-valuetext', formatUtc(this.date(this.t)));
    this.yearHead.style.left = `${(100 * this.t) / this.count}%`;
    this.updateLabels();
    this.hooks.onTime(this.t);
    if (settle) this.hooks.onSettle(this.t);
  }

  /** First sample of the 30-day page on screen. */
  get pageFirst(): number {
    return this.page;
  }

  private date(t: number): Date {
    return sampleDate(this.startIso, this.stepHours, t);
  }

  private updateLabels(): void {
    const d = this.date(this.t);
    this.el('.tb-date').textContent = formatUtc(d);
    this.el('.tb-day').textContent = `day ${Math.floor((this.t * this.stepHours) / 24) + 1}`;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tb-jump')) {
      b.disabled = this.hooks.nextEvent(b.dataset.kind as JumpKind, this.t) === null;
    }
  }

  private jump(kind: JumpKind): void {
    const next = this.hooks.nextEvent(kind, this.t);
    if (next === null) return;
    this.setPlaying(false, false);
    this.seek(next);
    this.hooks.onJump?.(kind);
  }

  // ---- Playback ---------------------------------------------------------

  setPlaying(on: boolean, settle = true): void {
    if (on && this.t >= this.count - 1) this.seek(0, false); // replay from the start
    if (on === this.playing) return;
    this.playing = on;
    this.playBtn.textContent = on ? '❚❚' : '▶';
    this.playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    this.playBtn.classList.toggle('on', on);
    if (on) {
      this.lastFrameMs = performance.now();
      this.frame = requestAnimationFrame((ms) => this.tick(ms));
    } else {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      if (settle) this.hooks.onSettle(this.t);
    }
  }

  private tick(ms: number): void {
    const dt = Math.min((ms - this.lastFrameMs) / 1000, MAX_FRAME_S);
    this.lastFrameMs = ms;
    const next = this.t + (dt * this.speed * 24) / this.stepHours;
    if (next >= this.count - 1) {
      this.seek(this.count - 1, false);
      this.setPlaying(false);
      return;
    }
    this.seek(next, false);
    this.frame = requestAnimationFrame((m) => this.tick(m));
  }

  private buildSpeedButtons(): void {
    const seg = this.el('.tb-speed');
    SPEEDS.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.label;
      b.setAttribute('aria-pressed', String(i === DEFAULT_SPEED));
      b.onclick = () => {
        this.speed = s.daysPerSec;
        for (const other of seg.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === b));
      };
      seg.append(b);
    });
  }

  // ---- Drawing ----------------------------------------------------------

  /** New lit / visible series (another grid spot, same time axis): repaint the bars. */
  setSeries(series: SiteSeries): void {
    this.series = series;
    this.drawAll();
  }

  private drawAll(): void {
    this.drawYear();
    this.drawTrack();
    this.drawTicks();
    this.placePageBox();
  }

  /** Paint samples [from, to) as runs of state color across the canvas. */
  private paint(canvas: HTMLCanvasElement, from: number, to: number): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.root);
    const colors = STATE_VARS.map((v) => css.getPropertyValue(v).trim() || '#222');
    const x = (i: number) => ((i - from) / (to - from)) * w;
    const sprites = loadSprites(() => this.drawAll());
    // Sprite art scale: whole pixels, so the bar fills the canvas height crisply.
    const k = Math.max(1, Math.round(h / SPRITE_H));
    const sh = SPRITE_H * k;
    const y = Math.round((h - sh) / 2);
    ctx.imageSmoothingEnabled = false;
    let runStart = from;
    for (let i = from + 1; i <= to; i++) {
      if (i === to || stateIndex(this.series, i) !== stateIndex(this.series, runStart)) {
        const state = stateIndex(this.series, runStart);
        const x0 = x(runStart);
        const rw = x(i) - x0;
        if (sprites) {
          this.drawRun(ctx, sprites[state], x0, y, rw, k, sh, runStart === from, i === to);
        } else {
          ctx.fillStyle = colors[state];
          ctx.fillRect(x0, 0, rw + 0.5, h); // +0.5 px closes hairline gaps
        }
        runStart = i;
      }
    }
  }

  /** One run as a 3-slice of the bar sprite; the ends overlap the neighbour so outlines don't double. */
  private drawRun(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x0: number, y: number, rw: number, k: number, sh: number, first: boolean, last: boolean): void {
    const cap = SPRITE_CAP * k;
    const left = first ? x0 : x0 - cap / 2; // half a cap into the previous run
    const width = rw + (first ? 0 : cap / 2) + (last ? 0 : cap / 2);
    const lx = Math.round(left);
    const w = Math.max(Math.round(left + width) - lx, 1);
    if (w < cap * 2) {
      // Too narrow for two caps: just the face, squeezed.
      ctx.drawImage(img, SPRITE_CAP, 0, SPRITE_W - 2 * SPRITE_CAP, SPRITE_H, lx, y, w, sh);
      return;
    }
    ctx.drawImage(img, 0, 0, SPRITE_CAP, SPRITE_H, lx, y, cap, sh);
    ctx.drawImage(img, SPRITE_CAP, 0, SPRITE_W - 2 * SPRITE_CAP, SPRITE_H, lx + cap, y, w - 2 * cap, sh);
    ctx.drawImage(img, SPRITE_W - SPRITE_CAP, 0, SPRITE_CAP, SPRITE_H, lx + w - cap, y, cap, sh);
  }

  private drawYear(): void {
    this.paint(this.yearCanvas, 0, this.count);
  }

  private drawTrack(): void {
    if (this.page < 0) return;
    this.paint(this.trackCanvas, this.page, Math.min(this.page + PAGE_SAMPLES, this.count));
  }

  private placePageBox(): void {
    if (this.page < 0) return;
    this.pageBox.style.left = `${(100 * this.page) / this.count}%`;
    this.pageBox.style.width = `${(100 * PAGE_SAMPLES) / this.count}%`;
  }

  /** Date labels every 5 days under the 30-day track. */
  private drawTicks(): void {
    if (this.page < 0) return;
    const box = this.el('.tb-ticks');
    box.replaceChildren();
    const perDay = 24 / this.stepHours;
    for (let day = 0; day <= 30; day += 5) {
      const i = this.page + day * perDay;
      const tick = document.createElement('span');
      tick.style.left = `${(100 * day * perDay) / PAGE_SAMPLES}%`;
      tick.textContent = shortDate(this.date(Math.min(i, this.count - 1)));
      box.append(tick);
    }
  }

  private buildMonthLabels(): void {
    const box = this.el('.tb-months');
    const t0 = Date.parse(this.startIso);
    const span = this.count * this.stepHours * 3600_000;
    const year = new Date(t0).getUTCFullYear();
    MONTHS.forEach((m, i) => {
      const at = Date.UTC(year, i, 1) - t0;
      if (at < 0 || at >= span) return;
      const s = document.createElement('span');
      s.style.left = `${(100 * at) / span}%`;
      s.textContent = m;
      box.append(s);
    });
  }

  private attachYearDrag(): void {
    const strip = this.el('.tb-year');
    const at = (ev: PointerEvent) => {
      const r = strip.getBoundingClientRect();
      return ((ev.clientX - r.left) / r.width) * this.count;
    };
    let dragging = false;
    strip.addEventListener('pointerdown', (ev) => {
      dragging = true;
      strip.setPointerCapture(ev.pointerId);
      this.setPlaying(false, false);
      this.seek(at(ev), false);
    });
    strip.addEventListener('pointermove', (ev) => dragging && this.seek(at(ev), false));
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.hooks.onSettle(this.t);
    };
    strip.addEventListener('pointerup', end);
    strip.addEventListener('pointercancel', end);
  }
}
