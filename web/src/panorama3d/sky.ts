// Sun, Earth and their tracks on the backdrop sphere. Positions come from the
// physics vectors (stretched by k); visibility is never decided here. The sky
// is drawn in its own pass before the skyline rings (see Scene3D), so ridges
// always cover it.

import * as THREE from 'three';
import { enuToThree, exaggerateEnu, type Vec3 } from './mapping';

const RAD = Math.PI / 180;
/** Longest Sun/Earth track drawn: 30 days of hourly samples (~one trip around the horizon is 709). */
export const MAX_TRACK_POINTS = 720;

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Fraction of Earth's visible disk that is lit, from the true Sun-Earth angle. */
export function earthLitFraction(sunTrue: Vec3, earthTrue: Vec3): number {
  const cos = dot(normalize(sunTrue), normalize(earthTrue));
  return (1 - cos) / 2;
}

/**
 * Light direction for the Earth sphere drawn at earthShown, so that its lit
 * fraction is the true one, (1 - cos theta) / 2 with theta the true Sun-Earth
 * angle, and its bright edge points toward the Sun as drawn. At k = 1 this is
 * exactly the true Sun direction. All vectors are unit, in any one frame.
 */
export function earthPhaseLight(sunTrue: Vec3, earthTrue: Vec3, sunShown: Vec3, earthShown: Vec3): Vec3 {
  const theta = Math.acos(Math.min(1, Math.max(-1, dot(normalize(sunTrue), normalize(earthTrue)))));
  const v = normalize(earthShown);
  const s = normalize(sunShown);
  let perp: Vec3 = [s[0] - dot(s, v) * v[0], s[1] - dot(s, v) * v[1], s[2] - dot(s, v) * v[2]];
  if (Math.hypot(...perp) < 1e-9) {
    // Sun straight behind or in front of Earth: any perpendicular will do.
    perp = Math.abs(v[2]) < 0.9 ? [-v[1], v[0], 0] : [0, -v[2], v[1]];
  }
  perp = normalize(perp);
  const phi = Math.PI - theta; // angle between the light and the direction back to the viewer
  return normalize([
    -Math.cos(phi) * v[0] + Math.sin(phi) * perp[0],
    -Math.cos(phi) * v[1] + Math.sin(phi) * perp[1],
    -Math.cos(phi) * v[2] + Math.sin(phi) * perp[2],
  ]);
}

const EARTH_YEAR_OPACITY = 0.12;

/** A faint line with one fixed buffer, rewritten in place as time moves (no GPU churn). */
function trackLine(color: number, opacity: number, order: number, points: number): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3));
  geo.setDrawRange(0, 0);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false,
  }));
  l.renderOrder = order;
  l.frustumCulled = false;
  return l;
}

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, color] of stops) grad.addColorStop(t, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function backdropSprite(tex: THREE.Texture, opacity: number, order: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  s.renderOrder = order;
  s.frustumCulled = false;
  return s;
}

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const EARTH_FRAG = /* glsl */ `
  uniform vec3 lightDir;
  uniform vec3 dayColor;
  varying vec3 vNormal;
  void main() {
    float lit = smoothstep(-0.03, 0.03, dot(normalize(vNormal), lightDir));
    gl_FragColor = vec4(mix(vec3(0.02, 0.03, 0.05), dayColor, lit), 1.0);
    #include <colorspace_fragment>
  }`;

export interface SkyState {
  sunEnu: Vec3; // true unit vectors, site frame
  earthEnu: Vec3;
  sunRadiusDeg: number;
  earthRadiusDeg: number;
  sunTrack: Vec3[]; // next ~29.5 days, true unit vectors
  earthTrack: Vec3[];
  sunGlow: number; // 0..1 from physics (no glow when the Sun is hidden)
}

/** Sun disk + glow, Earth sphere with phase, faint tracks. Drawn before the rings, in renderOrder. */
export class Sky {
  readonly group = new THREE.Group();
  private sun: THREE.Sprite;
  private glow: THREE.Sprite;
  private earth: THREE.Mesh;
  private earthMat: THREE.ShaderMaterial;
  private sunLine: THREE.Line;
  private earthLine: THREE.Line;
  private earthYearLine: THREE.Line;
  private earthYear: Vec3[] = [];
  private earthYearK = NaN; // stretch the year path was last written at (NaN = needs writing)

  constructor(private radius: number) {
    this.glow = backdropSprite(radialTexture([
      [0, 'rgba(255,220,140,0.55)'], [0.15, 'rgba(255,200,69,0.25)'], [1, 'rgba(255,200,69,0)'],
    ]), 1, 3);
    this.sun = backdropSprite(radialTexture([
      [0, '#fffaf0'], [0.9, '#fff1c8'], [0.97, 'rgba(255,241,200,0.6)'], [1, 'rgba(255,241,200,0)'],
    ]), 1, 4);

    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        lightDir: { value: new THREE.Vector3(1, 0, 0) },
        dayColor: { value: new THREE.Color(0x5aa9ff) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.earthMat);
    this.earth.renderOrder = 5;
    this.earth.frustumCulled = false;

    this.sunLine = trackLine(0xffc845, 0.3, 1, MAX_TRACK_POINTS);
    this.earthLine = trackLine(0x5aa9ff, 0.3, 1, MAX_TRACK_POINTS);
    // Where Earth goes over the whole year: the monthly loop drifts and changes
    // shape inside a box about 16 x 13 deg (libration). Sized in setEarthYear.
    this.earthYearLine = trackLine(0x5aa9ff, EARTH_YEAR_OPACITY, 0, 0);
    this.group.add(this.earthYearLine, this.sunLine, this.earthLine, this.glow, this.sun, this.earth);
  }

  /** Earth's direction at every sample of the year (true unit vectors), for the faint year path. */
  setEarthYear(pts: Vec3[]): void {
    this.earthYear = pts;
    const geo = this.earthYearLine.geometry;
    const attr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (attr.count < pts.length) {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.length * 3), 3));
    }
    this.earthYearK = NaN;
  }

  update(s: SkyState, k: number): void {
    const R = this.radius;
    const sunShown = exaggerateEnu(s.sunEnu, k);
    const earthShown = exaggerateEnu(s.earthEnu, k);

    // True angular size: a disk of angular radius r at distance R has radius R tan r.
    const sunPos = new THREE.Vector3(...enuToThree(sunShown)).multiplyScalar(R);
    const sunDiameter = 2 * R * Math.tan(s.sunRadiusDeg * RAD);
    this.sun.position.copy(sunPos);
    this.sun.scale.setScalar(sunDiameter);
    this.glow.position.copy(sunPos);
    this.glow.scale.setScalar(sunDiameter * 14);
    (this.glow.material as THREE.SpriteMaterial).opacity = s.sunGlow;

    this.earth.position.set(...enuToThree(earthShown)).multiplyScalar(R);
    this.earth.scale.setScalar(R * Math.tan(s.earthRadiusDeg * RAD));
    const L = earthPhaseLight(s.sunEnu, s.earthEnu, sunShown, earthShown);
    (this.earthMat.uniforms.lightDir.value as THREE.Vector3).set(...enuToThree(L));

    this.writeLine(s.sunTrack, this.sunLine, k);
    this.writeLine(s.earthTrack, this.earthLine, k);
    if (k !== this.earthYearK) { // the year path only changes with the stretch
      this.earthYearK = k;
      this.writeLine(this.earthYear, this.earthYearLine, k);
    }
  }

  /** Write directions into a line's fixed buffer (stretched by k), up to its size. */
  private writeLine(pts: Vec3[], lineObj: THREE.Line, k: number): void {
    const R = this.radius;
    const attr = lineObj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(pts.length, attr.count);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = enuToThree(exaggerateEnu(pts[i], k));
      attr.setXYZ(i, x * R * 0.999, y * R * 0.999, z * R * 0.999);
    }
    attr.needsUpdate = true;
    lineObj.geometry.setDrawRange(0, n);
  }
}
