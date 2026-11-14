// 360-degree horizon panorama drawn on a raw 2D canvas (the "2D strip" mode).
// Black sky, terrain silhouettes from the mask (layered by distance band when
// available), Sun/Earth dots, horizon line, compass ticks, drag with wraparound.

import { azToX, elToY, fitVertical, maskAt, vecToAzEl, wrapDeg, xToAz } from './geometry';
import type { PanoramaView } from './view';

export interface Body {
  az: number; // deg, site frame
  el: number; // deg
}

export interface PanoramaOptions {
  fovDeg?: number; // horizontal field of view shown across the canvas width
  exaggeration?: number; // vertical scale factor (1 = true scale); the maximum when fitting
}

const TOP_PAD_PX = 34; // room for the compass ticks and labels
const BOTTOM_PAD_PX = 12;

const COLORS = {
  sky: '#000000',
  terrain: '#2a2d33',
  bands: ['#5a5d63', '#3a3d44', '#26282d'], // near (0-5 km), mid, far: same as the 3D rings
  terrainEdge: '#8a8f99',
  horizon: 'rgba(255,255,255,0.18)',
  tick: 'rgba(255,255,255,0.45)',
  label: '#c8ccd4',
  sun: '#ffc845',
  earth: '#5aa9ff',
};

export class Panorama implements PanoramaView {
  private ctx: CanvasRenderingContext2D;
  private width = 0; // CSS px
  private height = 0;
  private dpr = 1;
  private frame = 0;

  yaw = 180; // deg, view direction at canvas center
  fovDeg: number;
  exaggeration: number; // current vertical stretch
  maxExaggeration: number;
  private readonly defaultMaxExaggeration: number;
  /** Elevation range (deg) to keep on screen; null = fixed stretch, horizon at 62%. */
  private fitRange: { min: number; max: number } | null = null;
  private fittedHorizonY = 0;
  mask: number[] = new Array(360).fill(0);
  bands: number[][] | null = null; // near, mid, far (rendering only)
  sun: Body | null = null;
  earth: Body | null = null;
  onChange: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, opts: PanoramaOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.fovDeg = opts.fovDeg ?? 360;
    this.maxExaggeration = opts.exaggeration ?? 5;
    this.defaultMaxExaggeration = this.maxExaggeration;
    this.exaggeration = this.maxExaggeration;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.attachDrag();
    this.resize();
  }

  setMask(mask: number[], bands: number[][] | null = null): void {
    this.mask = mask;
    this.bands = bands;
    this.requestDraw();
  }

  setYaw(deg: number): void {
    this.yaw = wrapDeg(deg);
    this.requestDraw();
    this.onChange?.();
  }

  setActive(on: boolean): void {
    this.canvas.hidden = !on;
    if (on) this.resize();
  }

  setTrueScale(on: boolean): void {
    this.maxExaggeration = on ? 1 : this.defaultMaxExaggeration;
    this.updateScale();
    this.requestDraw();
    this.onChange?.();
  }

  /** Set a body from its (e, n, u) vector in the site frame. */
  static bodyFromVector(e: number, n: number, u: number): Body {
    return vecToAzEl(e, n, u);
  }

  /**
   * Keep elevations minEl..maxEl (deg) on screen: the vertical stretch is
   * reduced from the maximum just enough to fit them in the canvas height.
   */
  fitElevations(minEl: number, maxEl: number): void {
    this.fitRange = { min: minEl, max: maxEl };
    this.updateScale();
    this.requestDraw();
  }

  private updateScale(): void {
    if (!this.fitRange) {
      this.exaggeration = this.maxExaggeration;
      return;
    }
    const fit = fitVertical(this.height, this.pxPerDeg, this.fitRange.min, this.fitRange.max,
      this.maxExaggeration, TOP_PAD_PX, BOTTOM_PAD_PX);
    this.exaggeration = fit.exaggeration;
    this.fittedHorizonY = fit.horizonY;
  }

  setBodies(sun: Body | null, earth: Body | null): void {
    this.sun = sun;
    this.earth = earth;
    this.requestDraw();
  }

  get pxPerDeg(): number {
    return this.width / this.fovDeg;
  }

  get pxPerDegV(): number {
    return this.pxPerDeg * this.exaggeration;
  }

  get horizonY(): number {
    return this.fitRange ? this.fittedHorizonY : this.height * 0.62;
  }

  requestDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // hidden (other view mode)
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.updateScale();
    this.requestDraw();
    this.onChange?.();
  }

  private attachDrag(): void {
    let lastX: number | null = null;
    this.canvas.addEventListener('pointerdown', (ev) => {
      lastX = ev.clientX;
      this.canvas.setPointerCapture(ev.pointerId);
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (lastX === null) return;
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      // Grab-and-drag: moving the pointer right pulls the scene right (view turns left).
      this.yaw = wrapDeg(this.yaw - dx / this.pxPerDeg);
      this.requestDraw();
      this.onChange?.();
    });
    const end = (ev: PointerEvent) => {
      lastX = null;
      if (this.canvas.hasPointerCapture(ev.pointerId)) this.canvas.releasePointerCapture(ev.pointerId);
      this.canvas.classList.remove('dragging');
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  /** Screen x positions where an azimuth appears (more than one near the wrap seam). */
  private xCopies(az: number, margin: number): number[] {
    const x = azToX(az, this.yaw, this.pxPerDeg, this.width);
    const period = 360 * this.pxPerDeg;
    return [x - period, x, x + period].filter((v) => v > -margin && v < this.width + margin);
  }

  private draw(): void {
    const { ctx, width, height } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, width, height);

    // Bodies first, so terrain in front of them hides them.
    if (this.earth) this.drawBody(this.earth, COLORS.earth, 6);
    if (this.sun) this.drawBody(this.sun, COLORS.sun, 5);

    this.drawTerrain();
    this.drawHorizonAndTicks();
  }

  private drawBody(body: Body, color: string, radiusPx: number): void {
    const { ctx } = this;
    const y = elToY(body.el, this.horizonY, this.pxPerDegV);
    for (const x of this.xCopies(body.az, radiusPx * 4)) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radiusPx * 4);
      glow.addColorStop(0, color);
      glow.addColorStop(0.25, color + '88');
      glow.addColorStop(1, color + '00');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radiusPx * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The silhouette is sampled per screen column, so wraparound comes for free:
  // each column looks up its own azimuth in the 360-value mask.
  // Bands are filled far to near, so the top edge seen is max(bands) = mask.
  private drawTerrain(): void {
    const { ctx, width } = this;
    if (this.bands) {
      for (let b = this.bands.length - 1; b >= 0; b--) {
        this.fillSilhouette(this.bands[b], COLORS.bands[b] ?? COLORS.terrain);
      }
    } else {
      this.fillSilhouette(this.mask, COLORS.terrain);
    }

    ctx.beginPath();
    for (let x = 0; x <= width; x += 1) {
      const az = xToAz(x, this.yaw, this.pxPerDeg, width);
      const y = elToY(maskAt(this.mask, az), this.horizonY, this.pxPerDegV);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = COLORS.terrainEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private fillSilhouette(mask: number[], color: string): void {
    const { ctx, width, height } = this;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 1) {
      const az = xToAz(x, this.yaw, this.pxPerDeg, width);
      const y = elToY(maskAt(mask, az), this.horizonY, this.pxPerDegV);
      ctx.lineTo(x, Math.min(y, height)); // "no terrain" bands (-90) stay off-screen
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawHorizonAndTicks(): void {
    const { ctx, width } = this;
    const y0 = this.horizonY;

    // Geometric horizon (elevation 0), dashed, drawn over terrain for reference.
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = COLORS.horizon;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(width, y0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Compass ticks along the top.
    const cardinal: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let az = 0; az < 360; az += 10) {
      const major = az % 30 === 0;
      for (const x of this.xCopies(az, 20)) {
        ctx.strokeStyle = COLORS.tick;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, major ? 10 : 5);
        ctx.stroke();
        if (major) {
          ctx.fillStyle = cardinal[az] ? COLORS.label : COLORS.tick;
          ctx.fillText(cardinal[az] ?? `${az}°`, x, 13);
        }
      }
    }
  }
}
