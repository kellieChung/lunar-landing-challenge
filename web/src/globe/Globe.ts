// 3D moon globe for the site picker: drag to rotate, wheel/pinch to zoom,
// click a pin to select a site. Labels are HTML so they stay sharp on video.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { latLonToVec } from './coords';
import { filterCollidingLabels, type LabelCandidate } from './collision';
import { createDistantEarth, createStarfield, createLimbHalo, type DistantEarth } from './spaceEnvironment';
import { PinVisualFactory, type PinVisual } from './pinMesh';

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
  visual: PinVisual;
}

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
  private keyLight: THREE.DirectionalLight;
  private distantEarth: DistantEarth | null = null;
  private occlusionSphere: THREE.Mesh;
  private hoveredPin: PinObject | null = null;
  private selectedId: string | null = null;
  private pinFactory = new PinVisualFactory();
  private logo: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; start: number; hold: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private labelLayer: HTMLElement,
  ) {
    // Throws if WebGL is unavailable; the caller keeps the HTML site list usable.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color(0x000000);

    // Deep-space starfield and distant Earth hanging in cislunar space
    const stars = createStarfield(75, 3500);
    this.scene.add(stars);

    this.distantEarth = createDistantEarth(30, 0.85);
    this.scene.add(this.distantEarth.mesh);

    // Fast occlusion proxy for pointer picking: avoids testing topography
    // triangles on every mousemove event.
    this.occlusionSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.97, 32, 16),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.scene.add(this.occlusionSphere);

    // Light rides with the camera (offset up-left) so the side you look at is
    // always readable, with low-angle shading that shows the craters.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.keyLight.position.set(-2, 1.5, 1);
    this.camera.add(this.keyLight);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 12;

    this.attachPicking();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const moon = gltf.scene;

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    let sum = 0;
    let n = 0;
    moon.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // If the model does not have UVs (e.g. legacy icosphere), generate spherical UVs.
        if (!obj.geometry.getAttribute('uv')) {
          obj.geometry = this.prepareMoonGeometry(obj.geometry);
        }

        const curMat = obj.material;
        const matWithMap =
          curMat instanceof THREE.MeshStandardMaterial && curMat.map
            ? curMat
            : Array.isArray(curMat) && curMat[0] instanceof THREE.MeshStandardMaterial && curMat[0].map
              ? (curMat[0] as THREE.MeshStandardMaterial)
              : null;

        if (matWithMap) {
          if (matWithMap.map) {
            matWithMap.map.anisotropy = maxAniso;
            matWithMap.map.colorSpace = THREE.SRGBColorSpace;
          }
          matWithMap.roughness = 0.94;
          matWithMap.metalness = 0.02;
          matWithMap.flatShading = false;
        } else {
          obj.material = new THREE.MeshStandardMaterial({
            color: 0x9a9a9a,
            roughness: 0.95,
            metalness: 0.02,
            flatShading: false,
          });
        }

        const pos = obj.geometry.getAttribute('position');
        const stride = Math.max(1, Math.floor(pos.count / 10000));
        for (let i = 0; i < pos.count; i += stride) {
          sum += Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
          n++;
        }
      }
    });
    // Scale so the mean surface radius is 1 if it deviates from 1.
    if (n > 0) {
      const meanR = sum / n;
      if (Math.abs(meanR - 1.0) > 0.005) {
        moon.scale.setScalar(1 / meanR);
      }
    }
    this.scene.add(moon);
    moon.updateMatrixWorld(true);
    this.moon = moon;

    // Soft Fresnel limb glow shell
    const halo = createLimbHalo(1.04);
    this.scene.add(halo);

    this.placePins();
  }

  /**
   * Prepares geometry by un-indexing, computing spherical UVs, and wrapping triangles
   * that cross the antimeridian (lon 180 deg) seam to prevent texture distortion.
   */
  private prepareMoonGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    const nonIndexed = geo.index ? (geo.toNonIndexed() as THREE.BufferGeometry) : geo.clone();
    const pos = nonIndexed.getAttribute('position');
    const uvs = new Float32Array(pos.count * 2);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, y, z);
      const lat = Math.asin(Math.max(-1, Math.min(1, y / r)));
      // Longitude: +X is lon 0 (facing Earth), -Z is lon 90 deg E
      const lon = Math.atan2(-z, x);
      uvs[i * 2] = (lon + Math.PI) / (2 * Math.PI);
      uvs[i * 2 + 1] = (lat + Math.PI / 2) / Math.PI;
    }

    // Seam wrapping: if a triangle spans across u = 0 and u = 1, shift smaller u by +1.0
    const triCount = pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = t * 3;
      const i1 = t * 3 + 1;
      const i2 = t * 3 + 2;
      const u0 = uvs[i0 * 2];
      const u1 = uvs[i1 * 2];
      const u2 = uvs[i2 * 2];
      const minU = Math.min(u0, u1, u2);
      const maxU = Math.max(u0, u1, u2);
      if (maxU - minU > 0.5) {
        if (u0 < 0.5) uvs[i0 * 2] += 1.0;
        if (u1 < 0.5) uvs[i1 * 2] += 1.0;
        if (u2 < 0.5) uvs[i2 * 2] += 1.0;
      }
    }

    nonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    nonIndexed.computeVertexNormals();
    return nonIndexed;
  }

  setPins(pins: GlobePin[]): void {
    for (const p of this.pins) {
      this.scene.remove(p.group);
      p.label.remove();
    }
    this.pins = pins.map((pin) => this.makePin(pin));
    this.placePins();
    this.updatePinStates();
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
    this.selectedId = id;
    this.updatePinStates();
  }

  private updatePinStates(): void {
    for (const p of this.pins) {
      const isSelected = p.pin.id === this.selectedId;
      const isHovered = p === this.hoveredPin;
      p.visual.setState(isSelected, isHovered);
      p.label.classList.toggle('selected', isSelected);
      p.label.classList.toggle('hovered', isHovered);
      p.label.setAttribute('aria-pressed', String(isSelected));
    }
  }

  /** Camera distance at which the moon fills ~75% of the narrower screen axis. */
  private fitDistance(): number {
    const halfV = (this.camera.fov / 2) * (Math.PI / 180);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const d = 1.15 / Math.tan(Math.min(halfV, halfH)) / 0.75;
    return Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, d));
  }

  /**
   * Project an image onto the Moon's near side as seen from the current
   * camera (like a slide projector), fade it in, hold, then fade it out.
   * The projection is frozen in world space, so it stays painted on the
   * surface if the user drags the globe. Pixels close to `keyColor` are
   * keyed out so only the artwork lands on the regolith.
   */
  async projectLogo(url: string, holdMs = 3000, keyColor = 0x2e3764): Promise<void> {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = tex.image as { width: number; height: number };
    const dir = this.camera.position.clone().normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const key = new THREE.Color(keyColor);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        map: { value: tex },
        dir: { value: dir },
        right: { value: right },
        up: { value: up },
        halfW: { value: 1.25 },
        aspect: { value: img.width / img.height },
        key: { value: new THREE.Vector3(key.r, key.g, key.b) },
        opacity: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 dir, right, up, key;
        uniform float halfW, aspect, opacity, time;
        varying vec3 vPos;
        float keyed(vec4 c) { return c.a * smoothstep(0.06, 0.18, distance(c.rgb, key)); }
        void main() {
          float facing = dot(normalize(vPos), dir);
          if (facing <= 0.0) discard;
          vec2 uv = vec2(dot(vPos, right) / halfW, dot(vPos, up) / (halfW / aspect)) * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
          // horizontal signal jitter on a few rows
          float row = floor(uv.y * 90.0);
          float jit = step(0.985, fract(sin(row * 12.9 + floor(time * 9.0)) * 43758.5)) * 0.012;
          vec2 u2 = uv + vec2(jit, 0.0);
          // RGB split like a misconverged projector
          float off = 0.0035;
          vec4 cr = texture2D(map, u2 + vec2(off, 0.0));
          vec4 cg = texture2D(map, u2);
          vec4 cb = texture2D(map, u2 - vec2(off, 0.0));
          vec3 col = vec3(cr.r * keyed(cr), cg.g * keyed(cg), cb.b * keyed(cb));
          float art = max(max(keyed(cr), keyed(cg)), keyed(cb));
          // scanlines + rolling refresh bar
          float scan = 0.72 + 0.28 * sin(uv.y * 520.0);
          float roll = 1.0 + 0.35 * smoothstep(0.06, 0.0, abs(fract(uv.y - time * 0.35) - 0.5));
          // faint glowing screen rectangle with a border, so it reads as a projected screen
          vec2 e = min(uv, 1.0 - uv);
          float edge = min(e.x, e.y * aspect);
          float border = smoothstep(0.012, 0.004, edge) * smoothstep(0.0, 0.003, edge);
          float panel = 0.10 * smoothstep(0.0, 0.05, edge);
          vec3 tint = vec3(0.45, 0.95, 1.0);
          vec3 rgb = col * mix(vec3(1.0), tint, 0.25) * scan * roll * 1.25 + tint * (panel + border * 0.9);
          float flick = 0.92 + 0.08 * sin(time * 53.0) * sin(time * 7.0);
          float a = clamp(art * scan + panel + border * 0.9, 0.0, 1.0) * opacity * flick * smoothstep(0.05, 0.3, facing);
          if (a < 0.01) discard;
          gl_FragColor = vec4(rgb, a);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.03, 96, 64), mat);
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.logo = { mesh, mat, start: performance.now(), hold: holdMs };
    return new Promise((resolve) => { this.logoDone = resolve; });
  }

  private logoDone: (() => void) | null = null;

  /** Skip the projected logo early (fades it out now). */
  dismissLogo(): void {
    if (!this.logo) return;
    const t = performance.now() - this.logo.start;
    const fadeIn = 900;
    if (t < fadeIn + this.logo.hold) this.logo.hold = Math.max(0, t - fadeIn);
  }

  private updateLogo(): void {
    if (!this.logo) return;
    const fadeIn = 900, fadeOut = 900;
    const t = performance.now() - this.logo.start;
    let o: number;
    if (t < fadeIn) o = t / fadeIn;
    else if (t < fadeIn + this.logo.hold) o = 1;
    else o = 1 - (t - fadeIn - this.logo.hold) / fadeOut;
    // a little projector flicker while it warms up
    if (t < fadeIn) o *= 0.75 + 0.25 * Math.sin(t * 0.08);
    this.logo.mat.uniforms.time.value = t / 1000;
    this.logo.mat.uniforms.opacity.value = Math.max(0, Math.min(1, o)) * 0.95;
    if (o <= 0 && t > fadeIn) {
      this.scene.remove(this.logo.mesh);
      this.logo.mesh.geometry.dispose();
      this.logo.mat.dispose();
      (this.logo.mat.uniforms.map.value as THREE.Texture).dispose();
      this.logo = null;
      this.logoDone?.();
      this.logoDone = null;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const lightWorldDir = new THREE.Vector3();
    const tick = () => {
      if (!this.running) return;
      this.controls.update();
      if (this.distantEarth) {
        this.keyLight.getWorldDirection(lightWorldDir);
        this.distantEarth.setLightDir(lightWorldDir.negate());
      }
      this.updateLogo();
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
    const visual = this.pinFactory.createPin();
    this.scene.add(visual.group);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'globe-label';
    label.textContent = pin.name;
    label.setAttribute('aria-pressed', 'false');
    label.addEventListener('click', () => this.onSelect?.(pin.id));
    this.labelLayer.appendChild(label);

    const pinObj: PinObject = {
      pin,
      group: visual.group,
      head: visual.head,
      hit: visual.hit,
      label,
      normal: new THREE.Vector3(),
      visual,
    };
    label.addEventListener('pointerenter', () => {
      this.hoveredPin = pinObj;
      this.updatePinStates();
    });
    label.addEventListener('pointerleave', () => {
      if (this.hoveredPin === pinObj) {
        this.hoveredPin = null;
        this.updatePinStates();
      }
    });
    return pinObj;
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

    interface Placed {
      pin: PinObject;
      x: number;
      y: number;
      priority: number;
    }

    const candidates: LabelCandidate<Placed>[] = [];

    for (const p of this.pins) {
      p.head.getWorldPosition(tip);
      toCam.subVectors(this.camera.position, tip);
      const facing = toCam.dot(p.normal) > 0;
      if (!facing || !this.moon) {
        p.label.hidden = true;
        continue;
      }
      tip.project(this.camera);
      const x = (tip.x * 0.5 + 0.5) * w;
      const y = (-tip.y * 0.5 + 0.5) * h;

      const lw = p.label.offsetWidth || 130;
      const lh = p.label.offsetHeight || 26;
      const left = x + 16;
      const top = y - 11;
      const isSelected = p.pin.id === this.selectedId;
      const isHovered = p === this.hoveredPin;
      const priority = isSelected ? 2 : isHovered ? 1 : 0;

      const placed: Placed = {
        pin: p,
        x,
        y,
        priority,
      };

      candidates.push({
        item: placed,
        rect: { left, top, right: left + lw, bottom: top + lh },
        priority,
      });
    }

    const visibleItems = new Set(filterCollidingLabels(candidates, 4));

    for (const p of this.pins) {
      const match = candidates.find((c) => c.item.pin === p && visibleItems.has(c.item));
      if (match) {
        p.label.hidden = false;
        p.label.style.transform = `translate(${match.item.x.toFixed(1)}px, ${match.item.y.toFixed(1)}px)`;
        p.label.style.zIndex = match.priority > 0 ? '10' : '1';
      } else {
        p.label.hidden = true;
      }
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
      if (this.occlusionSphere) targets.push(this.occlusionSphere);
      const first = this.raycaster.intersectObjects(targets, false)[0];
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
      const p = pinAt(ev);
      this.canvas.style.cursor = p ? 'pointer' : 'grab';
      if (this.hoveredPin !== (p ?? null)) {
        this.hoveredPin = p ?? null;
        this.updatePinStates();
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hoveredPin !== null) {
        this.hoveredPin = null;
        this.updatePinStates();
      }
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
