// First-person 3D panorama (three.js). The camera stands at the observer's
// eye (mast height) and only turns; it never moves.
//
// Three render passes:
//  1. Sky, no depth test: Earth's paths, Sun glow, Sun, Earth.
//  2. Skyline rings, no depth test, far to near, painting over the sky.
//     The sky needs its own pass: three.js draws opaque objects (the rings)
//     before transparent ones (everything in the sky) within one render(),
//     whatever their renderOrder, so a shared pass put the Sun and Earth in
//     front of ridges the physics says hide them. Because the camera never
//     moves, the backdrop radius doesn't matter and nothing z-fights.
//  3. Clear depth, then the near scene with depth: terrain mesh, lander, light.
//
// Rendering never decides visibility: "lit" and "Earth visible" are passed in
// from the physics (horizon mask); the scene only draws them.

import * as THREE from 'three';
import { maskAt } from '../panorama/geometry';
import type { PanoramaView } from '../panorama/view';
import { attachLookControls } from './controls';
import { regolithBumpTexture, regolithTexture, ridgeTexture } from './ground';
import {
  clampToMask, heightOnMesh, patchHole, terrainColors, terrainIndex, terrainPositions, terrainUVs, type Heightmap, type Hole,
} from './heightmap';
import { settle } from './footing';
import { buildLander, landerPlacement, type Lander } from './lander';
import {
  cameraEuler, defaultPitch, defaultVfov, enuToThree, exaggerateEnu, fitExaggeration3D, lensShiftPx, type Vec3,
} from './mapping';
import { Overlay, type OverlayBody } from './Overlay';
import { Effects } from './effects';
import { buildRing, maxMask, type Ring, type RingLight } from './rings';
import { earthLitFraction, Sky, type SkyState } from './sky';

const BACKDROP_R = 1000; // m; any value works since the camera never moves
const K_MAX = 5; // most vertical stretch; a site with tall terrain gets less (see fitExaggeration3D)
const DEFAULT_VFOV = 55; // the actual default comes from defaultVfov(aspect): at most 90 deg across
const USABLE_FRACTION = 0.8; // the whole year's shown elevation span fits in this much of the view height
// "Pitch" is a vertical lens shift (the camera stays level), so keep it moderate.
const PITCH_MIN = -35;
const PITCH_MAX = 35;
const PITCH_MAX_CINEMATIC = 70; // a launch may tilt the view further up to follow the rocket
const FOV_MIN = 8;
const FOV_MAX = 75;
const LIGHT_DIST = 20_000; // m
// Lighting (rendering only; never decides lit / visible):
const SUN_INTENSITY = 6; // the Sun is always low, so flat ground only gets a grazing share
// Readability fill so shapes never vanish at night. Not a physical light
// (real starlight is negligible); cool-tinted and kept well below sunlight so
// lit vs dark stays obvious.
const FILL_INTENSITY = 0.9;
const FILL_SKY = 0x7086b8;
const FILL_GROUND = 0x141518;
// Light bounced off sunlit ridges into a shadowed spot (real, and large at the
// poles): extra fill while the far ridges are lit but the local Sun is hidden.
const BOUNCE = 0.7;
const RING_FILL = 0.42; // the same fill, for the unlit skyline rings
// Earthshine: sunlight reflected by Earth. Real, pale blue, and strongest when
// Earth is up and nearly full. Scaled for display, not photometry.
const EARTHSHINE_MAX = 0.9;
const EARTHSHINE_COLOR = 0xa9c6ff;
const RING_STYLE = [
  // near (0-5 km), mid (5-30 km), far (30-150 km)
  { color: 0x767b84, edge: 0.45 },
  { color: 0x5a5f68, edge: 0.30 },
  { color: 0x3e434c, edge: 0.20 },
];

export interface SiteInput {
  mask: number[]; // physics horizon (deg)
  bands: number[][] | null; // near, mid, far (deg), rendering only
  terrain: Heightmap | null; // 100 m ground, about 10 x 10 km
  detail?: Heightmap | null; // 10 m patch around the observer, already stitched to `terrain`
  mastM: number;
  elRange: [number, number]; // whole year: lowest horizon .. highest Sun/Earth/ridge (deg)
  earthYear: Vec3[]; // Earth's direction at every sample of the year (true unit vectors)
  landerAz: number; // deg
}

/** An extra object standing on the ground near the viewer (game mode buildings, rovers). */
export interface SceneProp {
  object: THREE.Object3D; // built at true size in metres, standing on y = 0
  azDeg: number; // direction from the viewer
  distM: number; // true distance from the viewer
}

/** Called every frame while live (rendering only). Return false to stop. */
export type Ticker = (dt: number, now: number) => boolean | void;

export interface ViewState {
  yaw: number;
  pitch: number;
  zoom: number; // factor on the default field of view (1 = default, < 1 = zoomed in)
}

export interface TimeInput extends Omit<SkyState, 'sunGlow'> {
  sunLit: boolean; // from physics (horizon mask)
  earthMarginDeg: number; // from physics: Earth's center above (+) or below (-) the horizon
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function azElOf([e, n, u]: Vec3): { az: number; el: number } {
  const az = (Math.atan2(e, n) * 180) / Math.PI;
  return { az: az < 0 ? az + 360 : az, el: (Math.asin(u / Math.hypot(e, n, u)) * 180) / Math.PI };
}

export class Scene3D implements PanoramaView {
  onChange: (() => void) | null = null;
  onContextLost: (() => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(DEFAULT_VFOV, 1, 1, 80_000);
  private skyScene = new THREE.Scene();
  private backdrop = new THREE.Scene(); // skyline rings
  private near = new THREE.Scene();
  private sky = new Sky(BACKDROP_R);
  private rings: Ring[] = [];
  private terrainGroup = new THREE.Group();
  private terrainMeshes: THREE.Mesh[] = [];
  private lander: Lander = buildLander();
  private sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  private earthLight = new THREE.DirectionalLight(EARTHSHINE_COLOR, 0);
  private fill = new THREE.HemisphereLight(FILL_SKY, FILL_GROUND, FILL_INTENSITY);
  private groundTexture: THREE.Texture;
  private groundBump: THREE.Texture;
  private ridgeTexture: THREE.Texture;
  private overlay: Overlay;
  private lightCenter = new THREE.Vector3();
  private site: SiteInput | null = null;
  private time: TimeInput | null = null;
  private trueScale = false;
  private frame = 0;
  private timer = 0;
  private active = true;
  private tickers = new Map<Ticker, { full: boolean; idle?: () => boolean }>();
  private flashLight = new THREE.PointLight(0xffd9a0, 0, 1, 0); // always present (intensity 0), so lighting never recompiles
  private lastTick = 0;
  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeDur = 1;
  private shadowsDirty = false;
  /** Particles in the near scene (dust, exhaust, sparkles). */
  readonly fx = new Effects();
  /** While true the view may tilt further up (launch follow-cam). */
  cinematic = false;

  private _yaw = 180;
  private pitch = 0; // deg of (shown) elevation at screen center, done as a lens shift
  private baseVfov = DEFAULT_VFOV; // default for the canvas shape
  private zoom = 1; // user zoom factor on top of baseVfov
  private k = 1;

  constructor(private canvas: HTMLCanvasElement) {
    // Throws if WebGL is unavailable; the caller falls back to the 2D strip.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows only change with the Sun or the stretch, not when looking around:
    // redraw the shadow map only then (applyTime), not every frame.
    this.renderer.shadowMap.autoUpdate = false;

    this.camera.rotation.order = 'YXZ';
    this.skyScene.add(this.sky.group);

    this.near.add(this.fill);
    this.near.add(this.earthLight, this.earthLight.target);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.groundTexture = regolithTexture(maxAniso);
    this.groundBump = regolithBumpTexture(maxAniso);
    this.ridgeTexture = ridgeTexture(maxAniso);
    this.overlay = new Overlay(canvas.parentElement ?? document.body, (az) => this.setYaw(az));
    this.sunLight.castShadow = true;
    // About 3.5 m per texel over the 10 x 10 km ground at 4096, so the 10 m
    // patch keeps its small shadows; 2048 on GPUs that can't do 4096.
    const shadowSize = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = shadowSize >= 4096 ? 4 : 8;
    this.near.add(this.sunLight, this.sunLight.target, this.terrainGroup, this.lander.group, this.fx.group);
    this.flashLight.castShadow = false;
    this.near.add(this.flashLight);
    this.fx.onWake = () => this.requestRender();
    this.addTicker((dt) => { this.fx.update(dt, this.k, this.camera, this.canvas.height); }, { idle: () => !this.fx.live });

    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.onContextLost?.();
    });
    attachLookControls(canvas, {
      fovDeg: () => ({ h: this.hFovDeg, v: this.camera.fov }),
      look: (dy, dp) => {
        this._yaw = (((this._yaw + dy) % 360) + 360) % 360;
        this.pitch = Math.min(this.pitchMax, Math.max(PITCH_MIN, this.pitch + dp));
        this.applyProjection();
        this.changed();
      },
      zoom: (f) => {
        const fov = Math.min(FOV_MAX, Math.max(FOV_MIN, this.baseVfov * this.zoom * f));
        this.zoom = fov / this.baseVfov;
        this.applyProjection();
        this.changed();
      },
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get yaw(): number {
    return this._yaw;
  }

  get exaggeration(): number {
    return this.k;
  }

  private get hFovDeg(): number {
    const v = (this.camera.fov * Math.PI) / 360;
    return (2 * Math.atan(Math.tan(v) * this.camera.aspect) * 180) / Math.PI;
  }

  setYaw(deg: number): void {
    this._yaw = ((deg % 360) + 360) % 360;
    this.changed();
  }

  setActive(on: boolean): void {
    this.active = on;
    this.canvas.hidden = !on;
    this.overlay.setVisible(on);
    if (on) this.resize();
  }

  setTrueScale(on: boolean): void {
    this.trueScale = on;
    this.rebuild();
  }

  setSite(site: SiteInput): void {
    this.site = site;
    this.sky.setEarthYear(site.earthYear);
    for (const r of this.rings) {
      this.backdrop.remove(r.group);
      r.dispose();
    }
    const layers = site.bands ?? [site.mask];
    // Far first: draw order 10, 20, 30 (all after the sky's 0-9).
    this.rings = layers.map((_, i) => i).reverse().map((i, order) => {
      const style = RING_STYLE[site.bands ? i : 0];
      const ring = buildRing(layers[i], this.k, BACKDROP_R, style.color, style.edge, 10 + 10 * order, this.ridgeTexture);
      this.backdrop.add(ring.group);
      return ring;
    });

    this.buildTerrain();
    this.rebuild();
  }

  private terrainMaterial: THREE.MeshStandardMaterial | null = null;

  /** Add the 10 m patch once it has loaded, keeping the current view (no pitch reset). */
  setDetail(detail: Heightmap): void {
    if (!this.site) return;
    this.site = { ...this.site, detail };
    this.buildTerrain();
    this.rebuild(false);
  }

  private buildTerrain(): void {
    const site = this.site;
    for (const m of this.terrainMeshes) {
      this.terrainGroup.remove(m);
      m.geometry.dispose();
    }
    this.terrainMeshes = [];
    if (!site?.terrain) return;
    // The 10 m patch replaces the coarse cells under it (same material, so
    // texture and mottling run on across the seam).
    const hole = site.detail ? patchHole(site.terrain, site.detail) : null;
    if (site.detail && !hole) console.warn('terrain: detail patch is not aligned with the 100 m grid; not drawn');
    this.addTerrainMesh(site.terrain, site, hole, 'terrain');
    if (site.detail && hole) this.addTerrainMesh(site.detail, site, null, 'detail patch');
  }

  private addTerrainMesh(t: Heightmap, site: SiteInput, hole: Hole | null, label: string): void {
    const pos = terrainPositions(t, site.mastM);
    const moved = clampToMask(pos, site.bands?.[0] ?? site.mask, site.mask);
    if (moved > 0) console.info(`${label}: lowered ${moved} of ${t.nx * t.ny} vertices onto the physics horizon`);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(terrainUVs(t), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(terrainColors(t), 3));
    geo.setIndex(new THREE.BufferAttribute(terrainIndex(t.nx, t.ny, hole), 1));
    geo.computeVertexNormals();
    this.terrainMaterial ??= new THREE.MeshStandardMaterial({
      color: 0xc4c7cc,
      map: this.groundTexture,
      bumpMap: this.groundBump,
      bumpScale: 0.22,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.03,
    });
    const mesh = new THREE.Mesh(geo, this.terrainMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.terrainGroup.add(mesh);
    this.terrainMeshes.push(mesh);
  }

  private props: SceneProp[] = [];
  private movers: SceneProp[] = [];

  /** Replace the extra objects (rendering only; they never affect the physics). */
  setProps(props: SceneProp[]): void {
    for (const p of this.props) this.near.remove(p.object);
    this.props = props;
    for (const p of props) this.near.add(p.object);
    this.placeProps();
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Turn the view toward the props (game mode): their mean direction, slightly above them. */
  lookAtProps(): void {
    if (this.props.length === 0) return;
    let se = 0;
    let ce = 0;
    let el = 0;
    for (const p of this.props) {
      se += Math.sin((p.azDeg * Math.PI) / 180);
      ce += Math.cos((p.azDeg * Math.PI) / 180);
      const { x, y, z } = p.object.position;
      el += (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
    }
    this._yaw = (((Math.atan2(se, ce) * 180) / Math.PI) % 360 + 360) % 360;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, el / this.props.length + 6));
    this.applyProjection();
    this.changed();
  }

  /** Stand each prop on the drawn ground, scaled with the stretch like the lander. */
  private placeProps(): void {
    for (const p of this.props) this.stand(p);
    for (const p of this.movers) this.stand(p);
  }

  private stand(p: SceneProp): void {
    if (!this.site) return;
    const place = landerPlacement(this.site.detail ?? this.site.terrain, this.site.mastM, this.k, p.azDeg, p.distM);
    p.object.position.set(...place.pos);
    p.object.scale.setScalar(place.scale);
    // Laid out to be seen from +z: turn that side toward the eye.
    if (p.object.userData.faceViewer) p.object.rotation.y = Math.atan2(-place.pos[0], -place.pos[2]);
    this.settle(p.object);
  }

  /**
   * Fit a placed object to the slope under it (jacks or tilt, see footing.ts).
   * The ground is sampled in the object's own frame: true metres, turned with it.
   */
  private settle(o: THREE.Object3D): void {
    if (!this.site || (!o.userData.footing && !o.userData.tilt)) return;
    const t = this.site.detail ?? this.site.terrain;
    if (!t) return;
    const { k } = this;
    const { mastM } = this.site;
    const c = Math.cos(o.rotation.y);
    const s = Math.sin(o.rotation.y);
    const x0 = o.position.x;
    const y0 = o.position.y;
    const z0 = o.position.z;
    const lift = settle(o, (u, v) => {
      const x = x0 + k * (u * c + v * s);
      const z = z0 + k * (-u * s + v * c);
      const h = heightOnMesh(t, x, -z);
      return Number.isFinite(h) ? (k * (h - mastM) - y0) / k : 0;
    });
    o.position.y = y0 + lift * k;
  }

  /**
   * Objects that move on their own (rovers): kept apart from setProps, so
   * rebuilding the buildings never touches them. Change azDeg / distM, then
   * call placeMover to stand it on the ground there.
   */
  addMover(p: SceneProp): void {
    if (this.movers.includes(p)) return;
    this.movers.push(p);
    this.near.add(p.object);
    this.placeMover(p);
  }

  removeMover(p: SceneProp): void {
    const i = this.movers.indexOf(p);
    if (i < 0) return;
    this.movers.splice(i, 1);
    this.near.remove(p.object);
    this.shadowsDirty = true;
    this.requestRender();
  }

  placeMover(p: SceneProp): void {
    this.stand(p);
    this.shadowsDirty = true;
    this.requestRender();
  }

  /** Where a ground point (true metres from the viewer) is drawn, in scene units. */
  groundPoint(azDeg: number, distM: number, upM = 0): THREE.Vector3 {
    if (!this.site) return new THREE.Vector3();
    const place = landerPlacement(this.site.detail ?? this.site.terrain, this.site.mastM, this.k, azDeg, distM);
    return new THREE.Vector3(place.pos[0], place.pos[1] + upM * this.k, place.pos[2]);
  }

  /**
   * Run fn every frame until it returns false or the returned function is
   * called. Rendering only. `idle` tickers (ambient motion) run at a lower
   * frame rate when nothing else is animating, and `idle()` true skips them.
   */
  addTicker(fn: Ticker, opts: { lowRate?: boolean; idle?: () => boolean } = {}): () => void {
    const wrapped: Ticker = (dt, now) => fn(dt, now); // its own identity, so one fn can be added twice
    this.tickers.set(wrapped, { full: !opts.lowRate, idle: opts.idle });
    this.requestRender();
    return () => { this.tickers.delete(wrapped); };
  }

  /** A burst of warm light at a scene point that fades over `seconds` (ignition). */
  flash(p: THREE.Vector3, intensity: number, seconds: number, reachM = 60): void {
    this.flashLight.position.copy(p);
    this.flashLight.distance = reachM * this.k;
    let t = 0;
    this.addTicker((dt) => {
      t += dt;
      const f = Math.max(0, 1 - t / seconds);
      this.flashLight.intensity = intensity * f * f;
      return f > 0;
    });
  }

  /** The lander on its pad (the opening cutscene flies it in). */
  get landerGroup(): THREE.Group {
    return this.lander.group;
  }

  /** The lander's ground-standing parts (solar mast, jacks, shadow patch). */
  landerGroundParts(): THREE.Object3D[] {
    return this.lander.groundParts();
  }

  /** The current view, to tween from or restore later. */
  getView(): ViewState {
    return { yaw: this._yaw, pitch: this.pitch, zoom: this.zoom };
  }

  setView(v: Partial<ViewState>): void {
    if (v.yaw !== undefined) this._yaw = ((v.yaw % 360) + 360) % 360;
    if (v.pitch !== undefined) this.pitch = Math.min(this.pitchMax, Math.max(PITCH_MIN, v.pitch));
    if (v.zoom !== undefined) this.zoom = Math.min(FOV_MAX, Math.max(FOV_MIN, this.baseVfov * v.zoom)) / this.baseVfov;
    this.applyProjection();
    this.changed();
  }

  /** Ease the view to `to` over `seconds` (shortest way round in yaw). Resolves when done or cancelled. */
  tweenView(to: Partial<ViewState>, seconds: number): { done: Promise<void>; cancel: () => void } {
    const from = this.getView();
    const dYaw = to.yaw === undefined ? 0 : ((((to.yaw - from.yaw) % 360) + 540) % 360) - 180;
    let t = 0;
    let resolve = () => {};
    const done = new Promise<void>((r) => { resolve = r; });
    const stop = this.addTicker((dt) => {
      t += dt;
      const f = smoothstep(0, 1, seconds > 0 ? t / seconds : 1);
      this.setView({
        yaw: from.yaw + dYaw * f,
        pitch: to.pitch === undefined ? undefined : from.pitch + (to.pitch - from.pitch) * f,
        zoom: to.zoom === undefined ? undefined : from.zoom * Math.pow(to.zoom / from.zoom, f),
      });
      if (f >= 1) { resolve(); return false; }
      return true;
    });
    return { done, cancel: () => { stop(); resolve(); } };
  }

  /** Direction (deg) of a point in the scene from the eye: azimuth, and shown elevation. */
  aimAt(p: THREE.Vector3): { yaw: number; pitch: number } {
    const yaw = (Math.atan2(p.x, -p.z) * 180) / Math.PI;
    return { yaw: (yaw + 360) % 360, pitch: (Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180) / Math.PI };
  }

  /** Shake the view for a moment (decays); drawn only, the stored view stays put. */
  shake(amountDeg: number, seconds: number): void {
    this.shakeAmp = Math.max(this.shakeAmp * (this.shakeLeft / this.shakeDur), amountDeg);
    this.shakeLeft = this.shakeDur = seconds;
    const stop = this.addTicker((dt) => {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      if (this.shakeLeft === 0) { stop(); this.applyProjection(); return false; }
      return true;
    });
  }

  /** Where a scene point is on screen (viewport CSS px, like getBoundingClientRect), or null when behind the eye. */
  projectToScreen(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z >= 0) return null;
    p = p.clone().project(this.camera);
    const box = this.canvas.getBoundingClientRect();
    return { x: box.left + ((p.x + 1) / 2) * box.width, y: box.top + ((1 - p.y) / 2) * box.height };
  }

  /** The view tilts further up during a cinematic. */
  private get pitchMax(): number {
    return this.cinematic ? PITCH_MAX_CINEMATIC : PITCH_MAX;
  }

  /** Mark the shadows for redrawing on the next frame (something that casts one moved). */
  shadowsMoved(): void {
    this.shadowsDirty = true;
    this.requestRender();
  }

  setTime(time: TimeInput): void {
    this.time = time;
    this.applyTime();
    this.requestRender();
  }

  /** Recompute everything that depends on the stretch k. */
  private rebuild(resetPitch = true): void {
    if (!this.site) return;
    const [lo, hi] = this.site.elRange;
    this.k = this.trueScale ? 1 : fitExaggeration3D(lo, hi, USABLE_FRACTION * this.baseVfov, K_MAX);
    if (resetPitch) this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, defaultPitch(lo, hi, this.k)));
    this.applyProjection();
    for (const r of this.rings) r.update(this.k);
    this.fx.k = this.k;
    this.terrainGroup.scale.set(1, this.k, 1);
    this.terrainGroup.updateMatrixWorld(true);

    const place = landerPlacement(this.site.detail ?? this.site.terrain, this.site.mastM, this.k, this.site.landerAz);
    this.lander.group.position.set(...place.pos);
    this.lander.group.scale.setScalar(place.scale);
    // Turn its front (+z) toward the eye, so the panel mast stands beside it, not in front.
    this.lander.group.rotation.y = Math.atan2(-place.pos[0], -place.pos[2]);
    this.settle(this.lander.group);
    this.placeProps();

    // Shadow camera: an ortho box around the bounding sphere of the stretched mesh.
    const box = new THREE.Box3().setFromObject(this.terrainGroup);
    const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 100) : box.getBoundingSphere(new THREE.Sphere());
    const cam = this.sunLight.shadow.camera;
    cam.left = cam.bottom = -sphere.radius;
    cam.right = cam.top = sphere.radius;
    cam.near = Math.max(1, LIGHT_DIST - sphere.radius);
    cam.far = LIGHT_DIST + sphere.radius;
    cam.updateProjectionMatrix();
    this.sunLight.target.position.copy(sphere.center);
    this.lightCenter.copy(sphere.center);

    this.applyTime();
    this.changed();
  }

  private applyTime(): void {
    const t = this.time;
    const site = this.site;
    if (!t || !site) return;
    const sun = azElOf(t.sunEnu);
    const earth = azElOf(t.earthEnu);
    // The rings cast no shadows, so gate the light by the far horizon (5-150 km)
    // from the physics mask; the shadow map handles the near terrain itself.
    const far = site.bands ? maxMask(site.bands[1], site.bands[2]) : site.mask;
    const gate = smoothstep(-t.sunRadiusDeg, t.sunRadiusDeg, sun.el - maskAt(far, sun.az));
    this.sunLight.intensity = SUN_INTENSITY * gate;

    // Earthshine: along Earth's (shown) direction, by Earth's phase, only while
    // the physics says Earth is above the horizon (eased across its disk).
    const earthUp = smoothstep(-t.earthRadiusDeg, t.earthRadiusDeg, t.earthMarginDeg);
    const earthshine = earthLitFraction(t.sunEnu, t.earthEnu) * earthUp;
    this.earthLight.intensity = EARTHSHINE_MAX * earthshine;
    const eDir = new THREE.Vector3(...enuToThree(exaggerateEnu(t.earthEnu, this.k)));
    this.earthLight.position.copy(this.lightCenter).addScaledVector(eDir, LIGHT_DIST);
    this.earthLight.target.position.copy(this.lightCenter);
    this.earthLight.target.updateMatrixWorld();

    // Rings: distant ridges catch sunlight whenever the Sun is above the flat
    // horizon, and never look darker than the local physics allows. The
    // nearest ring is the sliver above the mesh, so it follows the mesh's light.
    const light: RingLight = {
      fill: RING_FILL, sunAz: sun.az, sunEl: sun.el, sunDay: 0,
      earthAz: earth.az, earthLight: earthshine,
    };
    const farDay = Math.max(gate, smoothstep(-t.sunRadiusDeg, t.sunRadiusDeg, sun.el));
    this.fill.intensity = FILL_INTENSITY * (1 + BOUNCE * Math.max(0, farDay - gate));
    this.rings.forEach((r, i) => {
      const nearest = site.bands !== null && i === this.rings.length - 1;
      r.shade({ ...light, sunDay: nearest ? gate : farDay });
    });

    const dir = new THREE.Vector3(...enuToThree(exaggerateEnu(t.sunEnu, this.k)));
    this.sunLight.position.copy(this.lightCenter).addScaledVector(dir, LIGHT_DIST);
    this.sunLight.target.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;

    this.sky.update({ ...t, sunGlow: t.sunLit ? 1 : 0 }, this.k);
    this.lander.setPanelLit(t.sunLit);
    this.lander.facePanels(sun.az);
  }

  private changed(): void {
    this.requestRender();
    this.onChange?.();
  }

  requestRender(): void {
    if (this.frame || !this.active) return;
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      this.tick(now);
      this.render();
      this.scheduleTick();
    });
  }

  /** Keep frames coming while tickers are live: every frame for animations, ~30 fps for ambient motion only. */
  private scheduleTick(): void {
    if (this.tickers.size === 0 || !this.active) {
      this.lastTick = 0;
      return;
    }
    const live = [...this.tickers.values()].filter((o) => !o.idle?.());
    if (live.length === 0) {
      this.lastTick = 0;
      return;
    }
    if (live.some((o) => o.full)) this.requestRender();
    else if (!this.timer) this.timer = window.setTimeout(() => { this.timer = 0; this.requestRender(); }, 33);
  }

  private tick(now: number): void {
    const dt = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 1 / 60;
    this.lastTick = now;
    for (const [fn, o] of [...this.tickers]) {
      if (o.idle?.()) continue;
      if (fn(dt, now) === false) this.tickers.delete(fn);
    }
    if (this.shadowsDirty) {
      this.shadowsDirty = false;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private render(): void {
    let shake = 0;
    if (this.shakeLeft > 0) {
      const f = this.shakeLeft / this.shakeDur;
      shake = this.shakeAmp * f * f;
    }
    const jitter = (s: number) => shake * Math.sin(performance.now() * s);
    const e = cameraEuler(this._yaw + jitter(0.071) + jitter(0.113) * 0.5, 0); // always level; pitch is the lens shift
    if (shake > 0) this.applyProjection(jitter(0.089) + jitter(0.131) * 0.5);
    this.camera.rotation.set(e.x, e.y, e.z, e.order);
    this.camera.updateMatrixWorld();
    this.renderer.clear();
    this.renderer.render(this.skyScene, this.camera);
    this.renderer.render(this.backdrop, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.near, this.camera);
    this.updateOverlay();
  }

  /** Compass strip and Sun/Earth markers, at where the disks are drawn. */
  private updateOverlay(): void {
    const t = this.time;
    if (!t) return;
    const body = (enu: Vec3, hidden: boolean): OverlayBody => {
      const p = new THREE.Vector3(...enuToThree(exaggerateEnu(enu, this.k)));
      const inFront = p.clone().applyQuaternion(this.camera.quaternion.clone().invert()).z < 0;
      p.project(this.camera);
      return { az: azElOf(enu).az, screen: { x: p.x, y: p.y, inFront }, hidden };
    };
    this.overlay.update({
      yaw: this._yaw,
      hfov: this.hFovDeg,
      sun: body(t.sunEnu, !t.sunLit),
      earth: body(t.earthEnu, t.earthMarginDeg <= 0),
    });
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const base = defaultVfov(w / h);
    if (Math.abs(base - this.baseVfov) > 0.5) {
      this.baseVfov = base;
      this.rebuild(false); // the stretch is fitted to the view height
    }
    this.applyProjection();
    this.changed();
  }

  /** Field of view and lens shift for the current canvas, zoom and pitch. */
  private applyProjection(pitchJitter = 0): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, this.baseVfov * this.zoom));
    this.camera.setViewOffset(w, h, 0, -lensShiftPx(this.pitch + pitchJitter, this.camera.fov, h), w, h);
    this.camera.updateProjectionMatrix();
  }
}
