// First-person 3D panorama (three.js). The camera stands at the observer's
// eye (mast height) and only turns; it never moves.
//
// Two render passes:
//  1. Backdrop, no depth test, drawn in a fixed order: Sun/Earth/tracks, then
//     the skyline rings far to near. Because the camera never moves, the
//     backdrop radius doesn't matter and nothing z-fights.
//  2. Clear depth, then the near scene with depth: terrain mesh, lander, light.
//
// Rendering never decides visibility: "lit" and "Earth visible" are passed in
// from the physics (horizon mask); the scene only draws them.

import * as THREE from 'three';
import { maskAt } from '../panorama/geometry';
import type { PanoramaView } from '../panorama/view';
import { attachLookControls } from './controls';
import { clampToMask, terrainIndex, terrainPositions, type Heightmap } from './heightmap';
import { buildLander, landerPlacement, type Lander } from './lander';
import { cameraEuler, defaultPitch, enuToThree, exaggerateEnu, fitExaggeration3D, type Vec3 } from './mapping';
import { buildRing, maxMask, type Ring } from './rings';
import { Sky, type SkyState } from './sky';

const BACKDROP_R = 1000; // m; any value works since the camera never moves
const K_MAX = 10;
const DEFAULT_VFOV = 60;
const USABLE_DEG = 54; // shown elevation span the whole year should fit in
const PITCH_MIN = -45;
const PITCH_MAX = 75;
const FOV_MIN = 8;
const FOV_MAX = 75;
const LIGHT_DIST = 20_000; // m
const AMBIENT = 0.12; // keeps shadowed ground readable (rendering only)
// The near ring shows as a thin sliver above the coarser mesh; tint it like the
// mesh (dark when the physics says the Sun is hidden) so it never reads as a lit ridge.
const NEAR_RING_DARK = new THREE.Color(0x303237);
const RING_STYLE = [
  // near (0-5 km), mid (5-30 km), far (30-150 km)
  { color: 0x5a5d63, edge: 0.5 },
  { color: 0x3a3d44, edge: 0.35 },
  { color: 0x26282d, edge: 0.25 },
];

export interface SiteInput {
  mask: number[]; // physics horizon (deg)
  bands: number[][] | null; // near, mid, far (deg), rendering only
  terrain: Heightmap | null;
  mastM: number;
  elRange: [number, number]; // whole year: lowest horizon .. highest Sun/Earth/ridge (deg)
  landerAz: number; // deg
}

export interface TimeInput extends Omit<SkyState, 'sunGlow'> {
  sunLit: boolean; // from physics (horizon mask)
}

function smoothstep(a: number, b: number, x: number): number {
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
  private backdrop = new THREE.Scene();
  private near = new THREE.Scene();
  private sky = new Sky(BACKDROP_R);
  private rings: Ring[] = [];
  private terrainGroup = new THREE.Group();
  private terrainMesh: THREE.Mesh | null = null;
  private lander: Lander = buildLander();
  private sunLight = new THREE.DirectionalLight(0xffffff, 3);
  private lightCenter = new THREE.Vector3();
  private site: SiteInput | null = null;
  private time: TimeInput | null = null;
  private trueScale = false;
  private frame = 0;
  private active = true;

  private _yaw = 180;
  private pitch = 0;
  private k = 1;

  constructor(private canvas: HTMLCanvasElement) {
    // Throws if WebGL is unavailable; the caller falls back to the 2D strip.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera.rotation.order = 'YXZ';
    this.backdrop.add(this.sky.group);

    this.near.add(new THREE.AmbientLight(0xffffff, AMBIENT));
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 15;
    this.near.add(this.sunLight, this.sunLight.target, this.terrainGroup, this.lander.group);

    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.onContextLost?.();
    });
    attachLookControls(canvas, {
      fovDeg: () => ({ h: this.hFovDeg, v: this.camera.fov }),
      look: (dy, dp) => {
        this._yaw = (((this._yaw + dy) % 360) + 360) % 360;
        this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + dp));
        this.changed();
      },
      zoom: (f) => {
        this.camera.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, this.camera.fov * f));
        this.camera.updateProjectionMatrix();
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
    if (on) this.resize();
  }

  setTrueScale(on: boolean): void {
    this.trueScale = on;
    this.rebuild();
  }

  setSite(site: SiteInput): void {
    this.site = site;
    for (const r of this.rings) {
      this.backdrop.remove(r.group);
      r.dispose();
    }
    const layers = site.bands ?? [site.mask];
    // Far first: draw order 10, 20, 30 (all after the sky's 0-9).
    this.rings = layers.map((_, i) => i).reverse().map((i, order) => {
      const style = RING_STYLE[site.bands ? i : 0];
      const ring = buildRing(layers[i], this.k, BACKDROP_R, style.color, style.edge, 10 + 10 * order);
      this.backdrop.add(ring.group);
      return ring;
    });

    if (this.terrainMesh) {
      this.terrainGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
      this.terrainMesh = null;
    }
    if (site.terrain) {
      const pos = terrainPositions(site.terrain, site.mastM);
      const moved = clampToMask(pos, site.bands?.[0] ?? site.mask, site.mask);
      if (moved > 0) console.info(`terrain: lowered ${moved} vertices onto the physics horizon`);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(terrainIndex(site.terrain.nx, site.terrain.ny), 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 1, metalness: 0, flatShading: true });
      this.terrainMesh = new THREE.Mesh(geo, mat);
      this.terrainMesh.castShadow = true;
      this.terrainMesh.receiveShadow = true;
      this.terrainGroup.add(this.terrainMesh);
    }
    this.rebuild();
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
    this.k = this.trueScale ? 1 : fitExaggeration3D(lo, hi, USABLE_DEG, K_MAX);
    if (resetPitch) this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, defaultPitch(lo, hi, this.k)));
    for (const r of this.rings) r.update(this.k);
    this.terrainGroup.scale.set(1, this.k, 1);
    this.terrainGroup.updateMatrixWorld(true);

    const place = landerPlacement(this.site.terrain, this.site.mastM, this.k, this.site.landerAz);
    this.lander.group.position.set(...place.pos);
    this.lander.group.scale.setScalar(place.scale);

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
    // The rings cast no shadows, so gate the light by the far horizon (5-150 km)
    // from the physics mask; the shadow map handles the near terrain itself.
    const far = site.bands ? maxMask(site.bands[1], site.bands[2]) : site.mask;
    const gate = smoothstep(-t.sunRadiusDeg, t.sunRadiusDeg, sun.el - maskAt(far, sun.az));
    this.sunLight.intensity = 3 * gate;
    if (site.bands) {
      const nearRing = this.rings[this.rings.length - 1]; // drawn last = nearest
      nearRing.setColor(NEAR_RING_DARK.clone().lerp(new THREE.Color(RING_STYLE[0].color), gate));
    }
    const dir = new THREE.Vector3(...enuToThree(exaggerateEnu(t.sunEnu, this.k)));
    this.sunLight.position.copy(this.lightCenter).addScaledVector(dir, LIGHT_DIST);
    this.sunLight.target.updateMatrixWorld();

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
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const e = cameraEuler(this._yaw, this.pitch);
    this.camera.rotation.set(e.x, e.y, e.z, e.order);
    this.camera.updateMatrixWorld();
    this.renderer.clear();
    this.renderer.render(this.backdrop, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.near, this.camera);
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.changed();
  }
}
