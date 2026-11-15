// Rovers in the 3D view that drive in and out instead of popping (rendering
// only; the rules in sim.ts decide where a rover is, hour by hour). Each rover
// keeps one model for the whole run. When it leaves the spot the viewer stands
// at, it turns toward its route, drives out past the buildings and away round
// the base, fading in the distance; coming home is the same in reverse, ending
// parked side-on in its own slot. The motion runs in real seconds, so it reads
// the same at every clock speed, and a rover that changes its mind half way
// (fast time) turns round from where it is.

import * as THREE from 'three';
import type { Effects } from '../panorama3d/effects';
import type { SceneProp } from '../panorama3d/Scene3D';

/** True metres from the viewer: x east, y north. */
export interface XY {
  x: number;
  y: number;
}

export interface Polar {
  azDeg: number;
  distM: number;
}

const RAD = Math.PI / 180;
const RING_M = 110; // beyond every building (the rocket pad's blast wall ends near 84 m)
const FAR_M = 210; // where a leaving rover has faded out
const SPEED_M_S = 70; // a time-lapse, not the real 0.15 m/s
const MIN_S = 1.8;
const MAX_S = 3.6;
const TURN_DEG_S = 220;
const FADE = 0.3; // last (leaving) / first (arriving) share of the path

export const wrap360 = (a: number) => ((a % 360) + 360) % 360;
/** Signed shortest turn from a to b, in [-180, 180). */
export const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

export function toXY(p: Polar): XY {
  return { x: Math.sin(p.azDeg * RAD) * p.distM, y: Math.cos(p.azDeg * RAD) * p.distM };
}

export function toPolar(p: XY): Polar {
  return { azDeg: wrap360(Math.atan2(p.x, p.y) / RAD), distM: Math.hypot(p.x, p.y) };
}

/** Compass bearing (deg) from one grid point to another, from their east / north offsets in km. */
export function bearingDeg(from: { dx_km: number; dy_km: number }, to: { dx_km: number; dy_km: number }): number {
  return wrap360(Math.atan2(to.dx_km - from.dx_km, to.dy_km - from.dy_km) / RAD);
}

function arc(from: Polar, to: Polar, pts: XY[]): void {
  const dAz = turn(from.azDeg, to.azDeg);
  const n = Math.max(2, Math.ceil(Math.abs(dAz) / 8));
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    pts.push(toXY({ azDeg: from.azDeg + dAz * f, distM: from.distM + (to.distM - from.distM) * f }));
  }
}

/** From `from` out to the far ring along `headingDeg`: straight out past the buildings, then round. */
export function pathOut(from: XY, headingDeg: number): XY[] {
  const pts = [from];
  let a = toPolar(from);
  if (a.distM < RING_M) {
    a = { azDeg: a.distM < 1 ? headingDeg : a.azDeg, distM: RING_M };
    pts.push(toXY(a));
  }
  arc(a, { azDeg: headingDeg, distM: FAR_M }, pts);
  return pts;
}

/** From `from` (usually far out) round to the slot's spoke, then straight in to the slot. */
export function pathIn(from: XY, slot: Polar): XY[] {
  const pts = [from];
  const a = toPolar(from);
  if (a.distM > RING_M + 1) arc(a, { azDeg: slot.azDeg, distM: RING_M }, pts);
  pts.push(toXY(slot));
  return pts;
}

export interface Track {
  pts: XY[];
  cum: number[]; // distance along the path at each point (m)
  length: number;
}

export function track(pts: XY[]): Track {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, length: cum[cum.length - 1] };
}

/** The point `s` metres along a track, and the direction of travel there (deg). */
export function along(t: Track, s: number): { p: XY; heading: number | null } {
  const { pts, cum } = t;
  if (pts.length < 2 || t.length === 0) return { p: pts[pts.length - 1], heading: null };
  s = Math.min(t.length, Math.max(0, s));
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1];
  const f = seg > 0 ? (s - cum[i - 1]) / seg : 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { p: { x: a.x + dx * f, y: a.y + dy * f }, heading: seg > 0 ? wrap360(Math.atan2(dx, dy) / RAD) : null };
}

/** What the rules say about one rover, as seen from where the viewer stands. */
export interface RoverSight {
  present: boolean; // standing at this spot (not driving to or from it)
  awayAz: number | null; // bearing toward the other end of its trip, when known
}

/** What the controller needs from the 3D scene. */
export interface MoverScene {
  addMover(p: SceneProp): void;
  placeMover(p: SceneProp): void;
  removeMover(p: SceneProp): void;
  groundPoint(azDeg: number, distM: number, upM?: number): THREE.Vector3;
  addTicker(fn: (dt: number) => boolean | void, opts?: { idle?: () => boolean }): () => void;
  readonly fx: Effects;
}

type Mode = 'parked' | 'leaving' | 'arriving' | 'away';

interface Bot {
  prop: SceneProp;
  mats: THREE.Material[];
  mode: Mode;
  pos: XY;
  facing: number; // deg, compass direction the nose points
  path: Track | null;
  t: number; // seconds of driving done on this path
  dur: number;
  heading: number; // last known bearing of its trip (to come home along)
  opacity: number;
  fadeFrom: number; // opacity when this path began
  dust: number;
}

export class RoverViz {
  private bots: Bot[] = [];
  private stopTicker: () => void;

  constructor(
    private scene: MoverScene,
    private make: () => THREE.Object3D,
    private slotOf: (index: number) => Polar,
  ) {
    this.stopTicker = scene.addTicker((dt) => { this.step(dt); }, { idle: () => !this.moving });
  }

  /** Any rover driving or turning (keeps frames coming). */
  get moving(): boolean {
    return this.bots.some((b) => b.mode === 'leaving' || b.mode === 'arriving' || (b.mode === 'parked' && Math.abs(turn(b.facing, this.parkFacing(b))) > 0.5));
  }

  modeOf(i: number): Mode | undefined {
    return this.bots[i]?.mode;
  }

  positionOf(i: number): XY | undefined {
    return this.bots[i]?.pos;
  }

  /** Compare with what the rules say. `snap`: the viewer just arrived here, so place everything at once. */
  sync(sights: RoverSight[], snap: boolean): void {
    while (this.bots.length < sights.length) this.bots.push(this.newBot(this.bots.length));
    sights.forEach((sight, i) => {
      const b = this.bots[i];
      if (sight.awayAz !== null) b.heading = sight.awayAz;
      if (snap) {
        if (sight.present) this.park(b, i);
        else this.hide(b);
        return;
      }
      if (sight.present && (b.mode === 'away' || b.mode === 'leaving')) this.arrive(b, i);
      else if (!sight.present && (b.mode === 'parked' || b.mode === 'arriving')) this.leave(b);
    });
    for (let i = sights.length; i < this.bots.length; i++) this.hide(this.bots[i]);
  }

  dispose(): void {
    this.stopTicker();
    for (const b of this.bots) this.scene.removeMover(b.prop);
    this.bots = [];
  }

  private newBot(i: number): Bot {
    const object = this.make();
    // Own copies of the materials, so one rover can fade without the others.
    const mats: THREE.Material[] = [];
    object.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = Array.isArray(o.material) ? o.material.map((m: THREE.Material) => m.clone()) : (o.material as THREE.Material).clone();
      mats.push(...(Array.isArray(o.material) ? o.material : [o.material]));
    });
    const slot = this.slotOf(i);
    const b: Bot = {
      prop: { object, azDeg: slot.azDeg, distM: slot.distM }, mats, mode: 'away', pos: toXY(slot),
      facing: wrap360(slot.azDeg + 90), path: null, t: 0, dur: 1, heading: slot.azDeg, opacity: 1, fadeFrom: 1, dust: 0,
    };
    object.visible = false;
    this.scene.addMover(b.prop);
    return b;
  }

  private parkFacing(b: Bot): number {
    return wrap360(this.slotOf(this.bots.indexOf(b)).azDeg + 90); // side-on to the viewer
  }

  private park(b: Bot, i: number): void {
    b.mode = 'parked';
    b.pos = toXY(this.slotOf(i));
    b.facing = this.parkFacing(b);
    b.path = null;
    this.setOpacity(b, 1);
    this.place(b);
  }

  private hide(b: Bot): void {
    b.mode = 'away';
    b.path = null;
    b.prop.object.visible = false;
  }

  private leave(b: Bot): void {
    b.mode = 'leaving';
    this.drive(b, pathOut(b.pos, b.heading));
  }

  private arrive(b: Bot, i: number): void {
    const slot = this.slotOf(i);
    if (b.mode === 'away') {
      b.pos = toXY({ azDeg: b.heading, distM: FAR_M });
      b.facing = wrap360(b.heading + 180);
      this.setOpacity(b, 0);
    }
    b.mode = 'arriving';
    this.drive(b, pathIn(b.pos, slot));
  }

  private drive(b: Bot, pts: XY[]): void {
    b.path = track(pts);
    b.t = 0;
    b.fadeFrom = b.opacity;
    b.dur = Math.min(MAX_S, Math.max(MIN_S, b.path.length / SPEED_M_S));
    b.prop.object.visible = true;
    this.place(b);
  }

  /** Advance every rover by dt seconds (the scene's ticker calls this). */
  step(dt: number): void {
    for (const b of this.bots) {
      if (b.mode === 'away') continue;
      if (b.mode === 'parked') {
        if (this.turnToward(b, this.parkFacing(b), dt)) this.place(b);
        continue;
      }
      const path = b.path!;
      const start = along(path, 0).heading;
      // Turn on the spot first, then drive.
      if (b.t === 0 && start !== null && Math.abs(turn(b.facing, start)) > 12) {
        this.turnToward(b, start, dt);
        this.place(b);
        continue;
      }
      b.t = Math.min(b.dur, b.t + dt);
      const u = b.t / b.dur;
      const eased = b.mode === 'leaving' ? u * u : 1 - (1 - u) * (1 - u);
      const s = eased * path.length;
      const at = along(path, s);
      b.pos = at.p;
      if (at.heading !== null) this.turnToward(b, at.heading, dt * 3);
      const f = path.length > 0 ? s / path.length : 1;
      const fade = Math.min(1, b.mode === 'leaving' ? (1 - f) / FADE : f / FADE);
      this.setOpacity(b, b.mode === 'leaving' ? Math.min(b.fadeFrom, fade) : b.fadeFrom + (1 - b.fadeFrom) * fade);
      this.kickDust(b, dt);
      if (u >= 1 && b.mode === 'leaving') {
        this.hide(b);
        continue;
      }
      if (u >= 1) {
        b.mode = 'parked';
        b.path = null;
        this.setOpacity(b, 1);
      }
      this.place(b);
    }
  }

  /** Rotate toward a bearing at the turn rate; true while still turning. */
  private turnToward(b: Bot, target: number, dt: number): boolean {
    const d = turn(b.facing, target);
    if (Math.abs(d) < 0.5) return false;
    const stepDeg = Math.sign(d) * Math.min(Math.abs(d), TURN_DEG_S * dt);
    b.facing = wrap360(b.facing + stepDeg);
    return true;
  }

  private kickDust(b: Bot, dt: number): void {
    b.dust -= dt;
    if (b.dust > 0) return;
    b.dust = 0.07;
    const p = toPolar(b.pos);
    if (p.distM > 160 || b.opacity < 0.3) return;
    this.scene.fx.dust(this.scene.groundPoint(p.azDeg, p.distM, 0.15), { count: 3, speedM: 0.7, sizeM: 0.3 });
  }

  private setOpacity(b: Bot, a: number): void {
    a = Math.max(0, Math.min(1, a));
    if (a === b.opacity) return;
    const wasSolid = b.opacity >= 1;
    b.opacity = a;
    const solid = a >= 1;
    for (const m of b.mats) {
      m.opacity = a;
      if (wasSolid !== solid) {
        m.transparent = !solid;
        m.needsUpdate = true;
      }
    }
    b.prop.object.visible = a > 0.01;
  }

  private place(b: Bot): void {
    const p = toPolar(b.pos);
    b.prop.azDeg = p.azDeg;
    b.prop.distM = p.distM;
    // The model drives along its +x; a bearing az points along (sin az, -cos az) in three.js.
    b.prop.object.rotation.y = (90 - b.facing) * RAD;
    this.scene.placeMover(b.prop);
  }
}
