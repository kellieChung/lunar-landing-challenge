// 3D moon globe for the site picker: drag to rotate, wheel/pinch to zoom,
// click a pin to select a site. Labels are HTML so they stay sharp on video.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { latLonToVec } from './coords';

export interface GlobePin {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface PinObject {
  pin: GlobePin;
  group: THREE.Group;
  head: THREE.Mesh;
  hit: THREE.Mesh; // larger invisible sphere, easier to click
  label: HTMLButtonElement;
  normal: THREE.Vector3; // outward unit vector at the pin
}

const SUN_GOLD = 0xffc845;
const CLICK_SLOP_PX = 5;

export class Globe {
  onSelect: ((id: string) => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private controls: OrbitControls;
  private moon: THREE.Object3D | null = null;
  private pins: PinObject[] = [];
  private running = false;
  private frame = 0;
  private raycaster = new THREE.Raycaster();

  constructor(
    private canvas: HTMLCanvasElement,
    private labelLayer: HTMLElement,
  ) {
    // Throws if WebGL is unavailable; the caller keeps the HTML site list usable.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color(0x000000);

    // Light rides with the camera (offset up-left) so the side you look at is
    // always readable, with low-angle shading that shows the craters.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 1.5, 1);
    this.camera.add(key);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 8;

    this.attachPicking();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const moon = gltf.scene;
    const material = new THREE.MeshStandardMaterial({
      color: 0x9a9a9a,
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
    });
    let sum = 0;
    let n = 0;
    moon.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.material = material;
        const pos = obj.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          sum += Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
          n++;
        }
      }
    });
    // Safety net: scale so the mean surface radius is 1, whatever the export scale.
    if (n > 0) moon.scale.setScalar(n / sum);
    this.scene.add(moon);
    moon.updateMatrixWorld(true);
    this.moon = moon;
    this.placePins();
  }

  setPins(pins: GlobePin[]): void {
    for (const p of this.pins) {
      this.scene.remove(p.group);
      p.label.remove();
    }
    this.pins = pins.map((pin) => this.makePin(pin));
    this.placePins();
  }

  /** Swing the camera toward (lat, lon), tilted toward the equator so the limb shows. */
  lookAt(lat: number, lon: number): void {
    // Flush leftover drag momentum first, or damping keeps spinning us away.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.camera.position.copy(this.viewPosition(lat, lon));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** Where lookAt(lat, lon) puts the camera (looking at the Moon's center, world up +Y). */
  viewPosition(lat: number, lon: number): THREE.Vector3 {
    const viewLat = Math.max(-70, Math.min(70, lat * 0.8));
    const [x, y, z] = latLonToVec(viewLat, lon);
    return new THREE.Vector3(x, y, z).multiplyScalar(this.fitDistance());
  }

  setSelected(id: string | null): void {
    for (const p of this.pins) {
      const on = p.pin.id === id;
      p.head.scale.setScalar(on ? 1.6 : 1);
      p.label.classList.toggle('selected', on);
      p.label.setAttribute('aria-pressed', String(on));
    }
  }

  /** Camera distance at which the moon fills ~75% of the narrower screen axis. */
  private fitDistance(): number {
    const halfV = (this.camera.fov / 2) * (Math.PI / 180);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const d = 1.15 / Math.tan(Math.min(halfV, halfH)) / 0.75;
    return Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, d));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private makePin(pin: GlobePin): PinObject {
    const gold = new THREE.MeshBasicMaterial({ color: SUN_GOLD });
    const group = new THREE.Group();
    const stalkLen = 0.07;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, stalkLen, 8), gold);
    stalk.position.y = stalkLen / 2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), gold);
    head.position.y = stalkLen;
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = stalkLen;
    group.add(stalk, head, hit);
    this.scene.add(group);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'globe-label';
    label.textContent = pin.name;
    label.setAttribute('aria-pressed', 'false');
    label.addEventListener('click', () => this.onSelect?.(pin.id));
    this.labelLayer.appendChild(label);

    return { pin, group, head, hit, label, normal: new THREE.Vector3() };
  }

  /** Sit each pin on the actual (bumpy) surface by raycasting toward the center. */
  private placePins(): void {
    if (!this.moon) return;
    const up = new THREE.Vector3(0, 1, 0);
    for (const p of this.pins) {
      const dir = new THREE.Vector3(...latLonToVec(p.pin.lat, p.pin.lon));
      this.raycaster.set(dir.clone().multiplyScalar(3), dir.clone().negate());
      const hit = this.raycaster.intersectObject(this.moon, true)[0];
      const surface = hit ? hit.point : dir.clone();
      p.normal.copy(dir);
      p.group.position.copy(surface);
      p.group.quaternion.setFromUnitVectors(up, dir);
    }
  }

  private updateLabels(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const tip = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    for (const p of this.pins) {
      p.head.getWorldPosition(tip);
      toCam.subVectors(this.camera.position, tip);
      const facing = toCam.dot(p.normal) > 0;
      p.label.hidden = !facing || !this.moon;
      if (p.label.hidden) continue;
      tip.project(this.camera);
      const x = (tip.x * 0.5 + 0.5) * w;
      const y = (-tip.y * 0.5 + 0.5) * h;
      p.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  private attachPicking(): void {
    let downX = 0;
    let downY = 0;
    const ndc = new THREE.Vector2();
    const pinAt = (ev: PointerEvent): PinObject | undefined => {
      const rect = this.canvas.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      const targets: THREE.Object3D[] = this.pins.map((p) => p.hit);
      if (this.moon) targets.push(this.moon);
      const first = this.raycaster.intersectObjects(targets, true)[0];
      return first && this.pins.find((p) => p.hit === first.object);
    };
    this.canvas.addEventListener('pointerdown', (ev) => {
      downX = ev.clientX;
      downY = ev.clientY;
    });
    this.canvas.addEventListener('pointerup', (ev) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > CLICK_SLOP_PX) return; // was a drag
      const p = pinAt(ev);
      if (p) this.onSelect?.(p.pin.id);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (ev.buttons) return;
      this.canvas.style.cursor = pinAt(ev) ? 'pointer' : 'grab';
    });
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
