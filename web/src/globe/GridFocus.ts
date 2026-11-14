// Zoomed-in "pick a spot" mode for the globe: flies the camera down onto one
// site and shows its 11 x 11 grid points (1 km apart) as dots colored by how
// much of 2027 each spot is in sunlight. Click a dot to pick it.
//
// Lives apart from Globe.ts (the site picker) and only uses its small hooks:
// parts(), frameHook, setPinsVisible(), viewPosition(). The dots sit on the
// current (low-poly) moon mesh by raycasting, so a better model drops in
// without changes here.
//
// The numbers on the dots come from sites.json (Python, horizon-mask physics);
// nothing here decides lit or visible.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GridSummary } from '../data/types';
import { describeOffset } from '../physics/grid';
import { formatLatLon, latLonToVec } from './coords';
import type { Globe } from './Globe';

const KM = 1 / 1737.4; // globe units per km (the mesh is scaled to mean radius 1)
const DOT_R = 0.3 * KM;
const HIT_R = 0.49 * KM; // nearly touching neighbours (1 km apart), so every click lands on a dot
const LIFT = 0.002 * KM; // dots float 2 m above the facet
const FLY_MS = 1400;
const VIEW_TILT_DEG = 42; // camera angle away from straight down
const GRID_FILL = 0.62; // the grid's width as a share of the smaller screen axis
const MIN_DIST = 6 * KM;
const MAX_DIST = 160 * KM;
const CLICK_SLOP_PX = 5;

// Sunlit share color scale (inferno-like, ending in the app's Sun gold),
// fixed 0-100% so sites compare fairly. The low end is spread out because
// most spots near the pole are lit well under half the time.
const STOPS: [number, THREE.Color][] = [
  [0, new THREE.Color(0x101218)],
  [12, new THREE.Color(0x3b2466)],
  [30, new THREE.Color(0x9c2f63)],
  [50, new THREE.Color(0xe0603a)],
  [75, new THREE.Color(0xffc845)],
  [100, new THREE.Color(0xfff2b8)],
];

/** Color for a % sunlit value (0-100). */
export function sunlitColor(pct: number): THREE.Color {
  const v = Math.min(100, Math.max(0, pct));
  for (let k = 1; k < STOPS.length; k++) {
    const [p1, c1] = STOPS[k];
    if (v <= p1) {
      const [p0, c0] = STOPS[k - 1];
      return c0.clone().lerp(c1, (v - p0) / (p1 - p0));
    }
  }
  return STOPS[STOPS.length - 1][1].clone();
}

export interface FocusSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  grid: GridSummary[];
}

interface Fly {
  start: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromDir: THREE.Vector3;
  turn: THREE.Quaternion; // rotates fromDir onto the final direction
  fromDist: number;
  toDist: number;
  fromQuat: THREE.Quaternion;
  toQuat: THREE.Quaternion;
  done: () => void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Card body for one picked grid point (the picker puts it in its side card). */
export function pointCard(site: FocusSite, p: GridSummary): HTMLElement[] {
  const stat = (label: string, value: string) => {
    const row = el('div', 'gp-stat');
    row.append(el('span', 'gp-k', label), el('span', 'gp-v', value));
    return row;
  };
  const stats = el('div', 'gp-stats');
  stats.append(
    stat('Sunlit', `${p.sunlit_pct.toFixed(1)}%`),
    stat('Earth visible', `${p.earth_pct.toFixed(1)}%`),
    stat('Both', `${p.both_pct.toFixed(1)}%`),
    stat('Longest night', `${(p.longest_dark_h / 24).toFixed(1)} days`),
  );
  const center = site.grid.find((q) => q.dx_km === 0 && q.dy_km === 0);
  const dz = center ? p.ground_m - center.ground_m : 0;
  const spot = describeOffset(p.dx_km, p.dy_km);
  const where = p.dx_km === 0 && p.dy_km === 0 ? spot
    : `${spot} · ground ${dz >= 0 ? '+' : '−'}${Math.abs(dz).toFixed(0)} m`;
  return [
    el('div', 'card-kind', 'Your spot · 2027'),
    el('h3', 'card-name', site.name),
    el('div', 'gp-where', where),
    el('div', 'card-coords', formatLatLon(p.lat, p.lon)),
    stats,
    Object.assign(el('a', 'go', 'Stand here →'), { href: `?site=${site.id}&pt=${p.i},${p.j}` }),
    el('p', 'gp-hint', 'Click another dot to compare. Brighter = more time in sunlight.'),
  ];
}

export class GridFocus {
  onPick: ((p: GridSummary) => void) | null = null;
  onExit: (() => void) | null = null;

  private site: FocusSite | null = null;
  private group = new THREE.Group();
  private dots: THREE.InstancedMesh | null = null;
  private outlines: THREE.InstancedMesh | null = null;
  private hits: THREE.InstancedMesh | null = null;
  private positions: THREE.Vector3[] = [];
  private normals: THREE.Vector3[] = [];
  private selRing: THREE.Mesh;
  private hoverRing: THREE.Mesh;
  private selected = -1;
  private hovered = -1;
  private controls: OrbitControls | null = null;
  private fly: Fly | null = null;
  private target = new THREE.Vector3();
  private savedNear: number;
  private savedFar: number;
  private raycaster = new THREE.Raycaster();
  private ui: {
    bar: HTMLElement; name: HTMLElement; legend: HTMLElement; compass: HTMLElement[]; tip: HTMLElement;
    globeHint: HTMLElement | null;
  };
  private compassAt: THREE.Vector3[] = [];

  constructor(private globe: Globe, overlay: HTMLElement) {
    const { scene, camera } = globe.parts();
    this.savedNear = camera.near;
    this.savedFar = camera.far;
    this.group.visible = false;
    this.group.renderOrder = 50;
    scene.add(this.group);

    const ring = (r0: number, r1: number, color: number, opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }),
      );
      m.renderOrder = 53;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.selRing = ring(DOT_R * 1.45, DOT_R * 1.9, 0xffffff, 1);
    this.hoverRing = ring(DOT_R * 1.3, DOT_R * 1.55, 0xffffff, 0.55);

    // HTML overlay: back button + site name, legend, compass letters, hover tip.
    const bar = el('div', 'gf-bar');
    const back = el('button', 'gf-back', '← Whole Moon');
    back.type = 'button';
    back.addEventListener('click', () => this.exit());
    const name = el('span', 'gf-name');
    bar.append(back, name);
    const legend = el('div', 'gf-legend');
    legend.append(el('div', 'gf-legend-title', 'Time in sunlight, 2027'), el('div', 'gf-ramp'));
    const ends = el('div', 'gf-legend-ends');
    ends.append(el('span', '', '0%'), el('span', '', '100%'));
    legend.append(ends, el('div', 'gf-legend-note', 'Dots 1 km apart · click one'));
    const compass = ['N', 'E', 'S', 'W'].map((c) => el('span', 'gf-compass', c));
    const tip = el('div', 'gf-tip');
    for (const n of [bar, legend, tip, ...compass]) {
      n.hidden = true;
      overlay.append(n);
    }
    const ramp = legend.querySelector('.gf-ramp') as HTMLElement;
    ramp.style.background = `linear-gradient(90deg, ${STOPS.map(([p, c]) => `#${c.getHexString()} ${p}%`).join(', ')})`;
    this.ui = { bar, name, legend, compass, tip, globeHint: overlay.querySelector('.globe-hint') };

    this.attachPicking();
  }

  get active(): boolean {
    return this.site !== null;
  }

  get siteId(): string | null {
    return this.site?.id ?? null;
  }

  /** Fly down onto a site and show its grid. ij picks the starting dot (default: center). */
  enter(site: FocusSite, ij: [number, number] = [0, 0]): void {
    const { camera, controls } = this.globe.parts();
    const fromTarget = this.active ? this.target.clone() : controls.target.clone();
    this.disposeControls();
    if (!this.active) {
      // Flush the globe's drag momentum, then hand the camera to us.
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      controls.enabled = false;
      this.globe.frameHook = () => this.tick();
      this.globe.setPinsVisible(false);
    }
    this.site = site;
    this.buildDots(site);
    const k = site.grid.findIndex((p) => p.i === ij[0] && p.j === ij[1]);
    this.setSelected(k >= 0 ? k : site.grid.findIndex((p) => p.dx_km === 0 && p.dy_km === 0));
    this.ui.name.textContent = site.name;
    this.showUi(false);

    const n = new THREE.Vector3(...latLonToVec(site.lat, site.lon));
    const center = this.surfacePoint(n);
    const north = this.localNorth(site.lat, site.lon);
    const tilt = (VIEW_TILT_DEG * Math.PI) / 180;
    const dist = this.fitDistance();
    // Camera on the equator side of the site, looking down toward the pole.
    const eye = center.clone()
      .addScaledVector(n, Math.cos(tilt) * dist)
      .addScaledVector(north, Math.sin(tilt) * dist);
    this.flyTo(fromTarget, center, eye, n, () => {
      camera.up.copy(n);
      const c = new OrbitControls(camera, this.globe.parts().canvas);
      c.target.copy(center);
      c.enablePan = false;
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      c.rotateSpeed = 0.5;
      c.minDistance = MIN_DIST;
      c.maxDistance = MAX_DIST;
      c.maxPolarAngle = (80 * Math.PI) / 180; // never look from below the ground
      c.update();
      this.controls = c;
      this.showUi(true);
    });
    this.target.copy(center);
  }

  /** Fly back out to the whole Moon and give the camera back to the globe. */
  exit(): void {
    const site = this.site;
    if (!site) return;
    const { camera, controls } = this.globe.parts();
    this.site = null;
    this.disposeControls();
    this.showUi(false);
    this.group.visible = false;
    const eye = this.globe.viewPosition(site.lat, site.lon);
    this.flyTo(this.target.clone(), new THREE.Vector3(), eye, new THREE.Vector3(0, 1, 0), () => {
      camera.up.set(0, 1, 0);
      camera.near = this.savedNear;
      camera.far = this.savedFar;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.enabled = true;
      controls.update();
      this.globe.frameHook = null;
      this.globe.setPinsVisible(true);
    });
    this.onExit?.();
  }

  // ---- Dots ----------------------------------------------------------------

  private buildDots(site: FocusSite): void {
    for (const m of [this.dots, this.outlines, this.hits]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const count = site.grid.length;
    // All transparent, so outline and dot are drawn in the same pass and renderOrder
    // puts the dot on top (opaque objects would otherwise be drawn first and get covered).
    const basic = (color: number, opacity = 1) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
    this.outlines = new THREE.InstancedMesh(new THREE.CircleGeometry(DOT_R * 1.22, 24), basic(0x000000, 0.7), count);
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(DOT_R, 24), basic(0xffffff), count);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.hits = new THREE.InstancedMesh(new THREE.CircleGeometry(HIT_R, 8), hitMat, count);
    this.outlines.renderOrder = 51;
    this.dots.renderOrder = 52;

    this.positions = [];
    this.normals = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const z = new THREE.Vector3(0, 0, 1);
    const one = new THREE.Vector3(1, 1, 1);
    site.grid.forEach((p, k) => {
      const n = new THREE.Vector3(...latLonToVec(p.lat, p.lon));
      const pos = this.surfacePoint(n).addScaledVector(n, LIFT);
      this.positions.push(pos);
      this.normals.push(n);
      q.setFromUnitVectors(z, n);
      m.compose(pos, q, one);
      this.outlines!.setMatrixAt(k, m);
      this.dots!.setMatrixAt(k, m);
      this.hits!.setMatrixAt(k, m);
      this.dots!.setColorAt(k, sunlitColor(p.sunlit_pct));
    });
    for (const mesh of [this.outlines, this.dots, this.hits]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    // Compass letters 6.5 km out from the center, along the site's own east/north.
    const c = this.positions[site.grid.findIndex((p) => p.dx_km === 0 && p.dy_km === 0)] ?? this.positions[0];
    const up = new THREE.Vector3(...latLonToVec(site.lat, site.lon));
    const north = this.localNorth(site.lat, site.lon);
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    const r = 6.6 * KM;
    this.compassAt = [north, east, north.clone().negate(), east.clone().negate()]
      .map((d) => c.clone().addScaledVector(d, r));
    this.group.visible = true;
  }

  private setSelected(k: number): void {
    this.selected = k;
    this.placeRing(this.selRing, k);
    if (k >= 0 && this.site) this.onPick?.(this.site.grid[k]);
  }

  private placeRing(ring: THREE.Mesh, k: number): void {
    ring.visible = k >= 0;
    if (k < 0) return;
    ring.position.copy(this.positions[k]);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.normals[k]);
  }

  // ---- Camera ----------------------------------------------------------------

  private flyTo(fromTarget: THREE.Vector3, toTarget: THREE.Vector3, eye: THREE.Vector3, up: THREE.Vector3,
    done: () => void): void {
    const { camera } = this.globe.parts();
    const fromOff = camera.position.clone().sub(fromTarget);
    const toOff = eye.clone().sub(toTarget);
    const fromDir = fromOff.clone().normalize();
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, toTarget, up));
    this.fly = {
      start: performance.now(),
      fromTarget: fromTarget.clone(),
      toTarget: toTarget.clone(),
      fromDir,
      turn: new THREE.Quaternion().setFromUnitVectors(fromDir, toOff.clone().normalize()),
      fromDist: fromOff.length(),
      toDist: toOff.length(),
      fromQuat: camera.quaternion.clone(),
      toQuat,
      done,
    };
  }

  private tick(): void {
    const { camera } = this.globe.parts();
    const f = this.fly;
    if (f) {
      const t = Math.min(1, (performance.now() - f.start) / FLY_MS);
      const e = ease(t);
      const target = f.fromTarget.clone().lerp(f.toTarget, e);
      const dir = f.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(f.turn, e));
      const dist = Math.exp(Math.log(f.fromDist) * (1 - e) + Math.log(f.toDist) * e);
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, e);
      this.fitClipping(dist);
      if (t >= 1) {
        this.fly = null;
        f.done();
      }
    } else if (this.controls) {
      this.controls.update();
      this.fitClipping(camera.position.distanceTo(this.controls.target));
    }
    this.updateOverlay();
  }

  /** Keep the depth range tight around what we look at (we go from 8 Moon radii down to ~10 km). */
  private fitClipping(dist: number): void {
    const { camera } = this.globe.parts();
    const near = Math.min(this.savedNear, Math.max(1e-5, dist * 0.02));
    if (Math.abs(near - camera.near) / camera.near > 0.05) {
      camera.near = near;
      camera.far = Math.max(this.savedFar, 10);
      camera.updateProjectionMatrix();
    }
  }

  private fitDistance(): number {
    const { camera } = this.globe.parts();
    const halfV = (camera.fov / 2) * (Math.PI / 180);
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const extent = 11 * KM; // 10 km grid plus a dot's margin
    return extent / GRID_FILL / (2 * Math.tan(Math.min(halfV, halfH)));
  }

  private disposeControls(): void {
    this.controls?.dispose();
    this.controls = null;
    this.fly = null;
  }

  /** Where the outward ray along unit vector n meets the moon mesh (or the unit sphere). */
  private surfacePoint(n: THREE.Vector3): THREE.Vector3 {
    const { moon } = this.globe.parts();
    if (moon) {
      this.raycaster.set(n.clone().multiplyScalar(3), n.clone().negate());
      const hit = this.raycaster.intersectObject(moon, true)[0];
      if (hit) return hit.point.clone();
    }
    return n.clone();
  }

  /** Unit vector toward lunar north along the surface at (lat, lon), in world axes. */
  private localNorth(lat: number, lon: number): THREE.Vector3 {
    const a = (lat * Math.PI) / 180;
    const b = (lon * Math.PI) / 180;
    // d/d(lat) of latLonToVec: (cos a cos b, sin a, -cos a sin b)
    return new THREE.Vector3(-Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)).normalize();
  }

  // ---- HTML overlay ------------------------------------------------------------

  private showUi(on: boolean): void {
    this.ui.bar.hidden = !this.active;
    if (this.ui.globeHint) this.ui.globeHint.hidden = this.active; // "click a pin" doesn't apply here
    this.ui.legend.hidden = !on;
    for (const c of this.ui.compass) c.hidden = !on;
    if (!on) this.ui.tip.hidden = true;
  }

  private updateOverlay(): void {
    if (this.fly || !this.controls) return;
    const { camera, canvas } = this.globe.parts();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const v = new THREE.Vector3();
    this.compassAt.forEach((p, k) => {
      v.copy(p).project(camera);
      const label = this.ui.compass[k];
      label.hidden = v.z > 1;
      label.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    });
  }

  private dotAt(ev: PointerEvent): number {
    if (!this.hits || !this.controls) return -1;
    const { camera, canvas } = this.globe.parts();
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObject(this.hits, false)[0];
    return hit?.instanceId ?? -1;
  }

  private attachPicking(): void {
    const { canvas } = this.globe.parts();
    let downX = 0;
    let downY = 0;
    canvas.addEventListener('pointerdown', (ev) => {
      downX = ev.clientX;
      downY = ev.clientY;
    });
    canvas.addEventListener('pointerup', (ev) => {
      if (!this.active || Math.hypot(ev.clientX - downX, ev.clientY - downY) > CLICK_SLOP_PX) return;
      const k = this.dotAt(ev);
      if (k >= 0) this.setSelected(k);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.active) return;
      const k = ev.buttons ? -1 : this.dotAt(ev);
      if (k !== this.hovered) {
        this.hovered = k;
        this.placeRing(this.hoverRing, k === this.selected ? -1 : k);
      }
      canvas.style.cursor = k >= 0 ? 'pointer' : 'grab';
      const tip = this.ui.tip;
      tip.hidden = k < 0 || !this.site;
      if (k >= 0 && this.site) {
        const p = this.site.grid[k];
        tip.textContent = `${p.sunlit_pct.toFixed(1)}% sunlit · ${p.earth_pct.toFixed(1)}% Earth`;
        const rect = canvas.getBoundingClientRect();
        tip.style.transform = `translate(${ev.clientX - rect.left + 14}px, ${ev.clientY - rect.top + 14}px)`;
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.ui.tip.hidden = true;
      this.hovered = -1;
      this.hoverRing.visible = false;
    });
  }
}
