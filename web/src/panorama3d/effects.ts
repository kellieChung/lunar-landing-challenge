// Particles for the game's moments (rendering only): regolith dust from rover
// wheels and the launch blast, the ascent engine's plume, steam from the plant
// vent, and sparkles. On the Moon there is no air: dust flies on clean
// ballistic arcs and falls straight back, it never billows or hangs.
//
// Positions are in scene units (the stretched world: 1 true metre = k units,
// see landerPlacement), so speeds and sizes given in metres are scaled by k.

import * as THREE from 'three';

const MAX = 2400; // per pool
const MOON_G = 1.62; // m/s^2

export interface Emit {
  at: THREE.Vector3; // scene units
  count: number;
  spreadM?: number; // random offset around `at` (m)
  vel?: [number, number, number]; // base velocity (m/s, three.js axes)
  jitterM?: number; // random extra speed in every direction (m/s)
  upM?: number; // random extra upward speed, 0..upM (m/s)
  life: [number, number]; // seconds
  sizeM: [number, number]; // start and end diameter (m)
  color: number;
  alpha: number;
  gravity?: number; // 1 = the Moon's
  drag?: number; // per second (only for gas: exhaust, steam)
  floor?: boolean; // stop on the ground where it was emitted (dust)
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / -mv.z, 0.0, 256.0);
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class Pool {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private s0 = new Float32Array(MAX);
  private s1 = new Float32Array(MAX);
  private a0 = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private floorY = new Float32Array(MAX); // NaN = no floor
  private geo = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  n = 0;

  constructor(additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false; // positions change every frame
    this.points.renderOrder = additive ? 2 : 1;
  }

  emit(e: Emit, k: number, few: boolean): void {
    const count = Math.max(1, Math.round(few ? e.count * 0.35 : e.count));
    const c = new THREE.Color(e.color);
    const spread = (e.spreadM ?? 0) * k;
    const jit = (e.jitterM ?? 0) * k;
    const [vx, vy, vz] = e.vel ?? [0, 0, 0];
    for (let q = 0; q < count; q++) {
      if (this.n >= MAX) return;
      const i = this.n++;
      const r = () => Math.random() * 2 - 1;
      this.pos[3 * i] = e.at.x + r() * spread;
      this.pos[3 * i + 1] = e.at.y + Math.abs(r()) * spread * 0.3;
      this.pos[3 * i + 2] = e.at.z + r() * spread;
      this.vel[3 * i] = (vx + 0) * k + r() * jit;
      this.vel[3 * i + 1] = vy * k + Math.random() * (e.upM ?? 0) * k + r() * jit * 0.5;
      this.vel[3 * i + 2] = vz * k + r() * jit;
      const shade = 0.85 + Math.random() * 0.3;
      this.col[3 * i] = Math.min(1, c.r * shade);
      this.col[3 * i + 1] = Math.min(1, c.g * shade);
      this.col[3 * i + 2] = Math.min(1, c.b * shade);
      this.age[i] = 0;
      this.life[i] = e.life[0] + Math.random() * (e.life[1] - e.life[0]);
      this.s0[i] = e.sizeM[0] * k * (0.7 + Math.random() * 0.6);
      this.s1[i] = e.sizeM[1] * k * (0.7 + Math.random() * 0.6);
      this.a0[i] = e.alpha;
      this.grav[i] = (e.gravity ?? 0) * MOON_G * k;
      this.drag[i] = e.drag ?? 0;
      this.floorY[i] = e.floor ? e.at.y : NaN;
      this.size[i] = this.s0[i];
      this.alpha[i] = 0;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    for (const a of [this.pos, this.vel, this.col]) {
      a[3 * i] = a[3 * j];
      a[3 * i + 1] = a[3 * j + 1];
      a[3 * i + 2] = a[3 * j + 2];
    }
    for (const a of [this.size, this.alpha, this.age, this.life, this.s0, this.s1, this.a0, this.grav, this.drag, this.floorY]) a[i] = a[j];
  }

  update(dt: number, scale: number): void {
    this.material.uniforms.uScale.value = scale;
    for (let i = this.n - 1; i >= 0; i--) {
      const age = (this.age[i] += dt);
      const life = this.life[i];
      if (age >= life) {
        this.kill(i);
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[3 * i] *= d;
      this.vel[3 * i + 1] = this.vel[3 * i + 1] * d - this.grav[i] * dt;
      this.vel[3 * i + 2] *= d;
      this.pos[3 * i] += this.vel[3 * i] * dt;
      this.pos[3 * i + 1] += this.vel[3 * i + 1] * dt;
      this.pos[3 * i + 2] += this.vel[3 * i + 2] * dt;
      const floor = this.floorY[i];
      if (floor === floor && this.pos[3 * i + 1] < floor) {
        // Landed: it skids a little and stops (no air to carry it).
        this.pos[3 * i + 1] = floor;
        this.vel[3 * i] *= 0.4;
        this.vel[3 * i + 1] = 0;
        this.vel[3 * i + 2] *= 0.4;
        this.grav[i] = 0;
        this.drag[i] = 6;
      }
      const t = age / life;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * Math.min(1, t * 10) * Math.pow(1 - t, 1.5);
    }
    this.geo.setDrawRange(0, this.n);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }
}

export class Effects {
  readonly group = new THREE.Group();
  /** Fewer particles (reduced motion). */
  few = false;
  /** Set by the scene: start drawing frames again. */
  onWake: (() => void) | null = null;
  private dustPool = new Pool(false);
  private glowPool = new Pool(true);
  /** Scene units per true metre (the stretch); the scene keeps it current. */
  k = 1;

  constructor() {
    this.group.add(this.dustPool.points, this.glowPool.points);
  }

  get live(): boolean {
    return this.dustPool.n + this.glowPool.n > 0;
  }

  emit(e: Emit, glow = false): void {
    (glow ? this.glowPool : this.dustPool).emit(e, this.k, this.few);
    this.onWake?.();
  }

  /** Grey regolith kicked up (wheels, a dumped load): ballistic, falls straight back. */
  dust(at: THREE.Vector3, o: { count?: number; speedM?: number; sizeM?: number; vel?: [number, number, number] } = {}): void {
    const sp = o.speedM ?? 1.2;
    this.emit({
      at, count: o.count ?? 10, spreadM: 0.4, vel: o.vel, jitterM: sp, upM: sp * 1.4,
      life: [0.6, 1.4], sizeM: [o.sizeM ?? 0.35, (o.sizeM ?? 0.35) * 1.8], color: 0xa8a49c, alpha: 0.55, gravity: 1, floor: true,
    });
  }

  /** The launch blast: a ring of dust thrown flat and fast across the pad. */
  blast(at: THREE.Vector3, o: { count?: number; speedM?: number } = {}): void {
    const n = o.count ?? 220;
    const sp = o.speedM ?? 18;
    for (let q = 0; q < n; q++) {
      const a = Math.random() * Math.PI * 2;
      const v = sp * (0.4 + Math.random() * 0.8);
      this.emit({
        at, count: 1, spreadM: 1.5, vel: [Math.sin(a) * v, 0.6 + Math.random() * 2.5, Math.cos(a) * v],
        life: [1.2, 2.6], sizeM: [0.8, 3.2], color: 0xb4afa6, alpha: 0.6, gravity: 1, floor: true,
      });
    }
  }

  /** Engine plume: hot, additive, leaving along `dir` (m/s, three.js axes). */
  exhaust(at: THREE.Vector3, dir: [number, number, number], o: { count?: number; sizeM?: number } = {}): void {
    this.emit({
      at, count: o.count ?? 6, spreadM: 0.25, vel: dir, jitterM: 1.5,
      life: [0.25, 0.6], sizeM: [o.sizeM ?? 1.4, (o.sizeM ?? 1.4) * 2.6], color: 0xffb35a, alpha: 0.9, drag: 1.5,
    }, true);
    this.emit({
      at, count: 2, spreadM: 0.1, vel: dir, jitterM: 0.5,
      life: [0.1, 0.25], sizeM: [(o.sizeM ?? 1.4) * 0.8, (o.sizeM ?? 1.4) * 1.2], color: 0xfff4dc, alpha: 1,
    }, true);
  }

  /** A soft puff from the plant vent while it works (pale, rises, fades fast in vacuum). */
  steam(at: THREE.Vector3): void {
    this.emit({
      at, count: 2, spreadM: 0.1, vel: [0, 0.9, 0], jitterM: 0.25,
      life: [1.0, 1.8], sizeM: [0.25, 1.1], color: 0xe9eef5, alpha: 0.28, drag: 0.6,
    });
  }

  /** Gold specks bursting out and drifting down (milestones). */
  sparkle(at: THREE.Vector3, o: { count?: number; speedM?: number } = {}): void {
    this.emit({
      at, count: o.count ?? 40, spreadM: 0.5, jitterM: o.speedM ?? 3, upM: 2,
      life: [0.8, 1.6], sizeM: [0.5, 0.15], color: 0xffd36b, alpha: 1, gravity: 0.6,
    }, true);
  }

  clear(): void {
    this.dustPool.clear();
    this.glowPool.clear();
  }

  /** Advance every particle; `bufferH` is the drawing buffer height (device px). */
  update(dt: number, k: number, camera: THREE.PerspectiveCamera, bufferH: number): void {
    this.k = k;
    const scale = bufferH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.dustPool.update(dt, scale);
    this.glowPool.update(dt, scale);
  }
}
