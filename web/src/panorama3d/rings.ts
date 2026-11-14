// Skyline rings: curtains around the eye whose top edge at each azimuth sits
// exactly at a horizon-mask elevation (shown with the stretch k). Drawn far to
// near, so what you see on top is max(bands) = mask_deg, the physics horizon.

import * as THREE from 'three';
import { maskAt } from '../panorama/geometry';
import { exaggerateEl } from './mapping';

const RAD = Math.PI / 180;
const MIN_TRUE_DEG = -89; // "no terrain" (-90) and anything below is pulled up to this

// ---- Shading (rendering only: never decides lit / visible) ----

/** How the rings are lit at one moment. All angles in degrees, true scale. */
export interface RingLight {
  fill: number; // night readability fill, 0..1 (matches the scene's hemisphere light)
  sunAz: number;
  sunEl: number; // true elevation
  sunDay: number; // 0..1: how much sunlight reaches this band's ridges
  earthAz: number;
  earthLight: number; // 0..1 Earthshine strength
}

const SUN_WEIGHT = 1.0;
const EARTH_WEIGHT = 0.35;
export const GLOW_BELOW_DEG = 3; // rim glow while the Sun is up to this far below a ridge
const GLOW_WIDTH_DEG = 8; // azimuth spread of the rim glow

/**
 * Brightness of the ridge at azimuth colAz. A ridge face looks back toward
 * the viewer, so it is lit when the light is behind the viewer: strongest
 * at 180 deg from the Sun, darker (backlit) toward the Sun.
 */
export function ringShade(colAz: number, L: RingLight): number {
  const facing = (lightAz: number) => Math.max(0, -Math.cos((colAz - lightAz) * RAD));
  const sun = L.sunDay * (0.35 + 0.65 * facing(L.sunAz)) * SUN_WEIGHT;
  const earth = L.earthLight * facing(L.earthAz) * EARTH_WEIGHT;
  return L.fill + sun + earth;
}

/**
 * Golden rim glow 0..1 on a ridge edge at colAz, when the Sun is just behind
 * that ridge (up to GLOW_BELOW_DEG below its top at the Sun's azimuth).
 * A pointer to the hidden Sun, not a physics result.
 */
export function rimGlow(colAz: number, mask: number[], L: RingLight): number {
  const below = maskAt(mask, L.sunAz) - L.sunEl;
  if (below <= 0 || below >= GLOW_BELOW_DEG) return 0;
  const strength = 1 - below / GLOW_BELOW_DEG;
  const d = ((colAz - L.sunAz + 540) % 360) - 180;
  return strength * Math.exp(-((d / GLOW_WIDTH_DEG) ** 2));
}

/**
 * Vertex positions for one ring at horizontal radius `radius`: for each of
 * mask.length + 1 columns (the last repeats the first to close the seam) a
 * top vertex at the shown mask elevation and a bottom vertex at bottomDeg.
 * Layout: [top0, bottom0, top1, bottom1, ...], three.js axes.
 */
export function ringPositions(mask: number[], k: number, radius: number, bottomDeg = -80): Float32Array {
  const n = mask.length;
  const out = new Float32Array((n + 1) * 2 * 3);
  const yBottom = Math.tan(bottomDeg * RAD) * radius;
  for (let c = 0; c <= n; c++) {
    const az = ((c % n) * 360) / n;
    const shown = Math.max(exaggerateEl(Math.max(mask[c % n], MIN_TRUE_DEG), k), bottomDeg);
    const x = Math.sin(az * RAD) * radius;
    const z = -Math.cos(az * RAD) * radius;
    out.set([x, Math.tan(shown * RAD) * radius, z, x, yBottom, z], c * 6);
  }
  return out;
}

/** Element-wise max of several masks. */
export function maxMask(...masks: number[][]): number[] {
  return masks[0].map((_, i) => Math.max(...masks.map((m) => m[i])));
}

/** Triangle indices for a ring laid out by ringPositions. */
function ringIndex(columns: number): number[] {
  const idx: number[] = [];
  for (let c = 0; c < columns; c++) {
    const t0 = 2 * c;
    const b0 = t0 + 1;
    const t1 = t0 + 2;
    const b1 = t0 + 3;
    idx.push(t0, b0, t1, t1, b0, b1);
  }
  return idx;
}

export interface Ring {
  group: THREE.Group;
  update(k: number): void;
  /** Recolor for the current light (cheap; call every time step). */
  shade(light: RingLight): void;
  dispose(): void;
}

const EDGE_GREY = new THREE.Color(0xc8ccd4);
const GLOW = new THREE.Color(0xffc845);

/**
 * One ring: a flat curtain plus a brighter edge line along its top, both
 * colored per column by ringShade / rimGlow. Backdrop objects never
 * depth-test; `order` sets the draw order (far first).
 */
export function buildRing(
  mask: number[],
  k: number,
  radius: number,
  color: number,
  edgeAlpha: number,
  order: number,
  texture?: THREE.Texture | null,
): Ring {
  const n = mask.length;
  const base = new THREE.Color(color);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));

  // Seamless cylindrical UVs: u tiles around the 360 deg azimuth, v runs 0 (base) to 1 (ridge crest)
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const uTiles = 14;
  for (let c = 0; c <= n; c++) {
    const u = (c / n) * uTiles;
    uvs[c * 4] = u;
    uvs[c * 4 + 1] = 1.0;
    uvs[c * 4 + 2] = u;
    uvs[c * 4 + 3] = 0.0;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(ringIndex(n));

  const mat = new THREE.MeshBasicMaterial({
    map: texture ?? null,
    vertexColors: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
  const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false });
  const edge = new THREE.Line(edgeGeo, edgeMat);
  edge.renderOrder = order + 0.5;
  edge.frustumCulled = false;

  const update = (kk: number) => {
    const pos = ringPositions(mask, kk, radius);
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    (posAttr.array as Float32Array).set(pos);
    posAttr.needsUpdate = true;
    const tops = edgeGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let c = 0; c <= n; c++) (tops.array as Float32Array).set(pos.subarray(c * 6, c * 6 + 3), c * 3);
    tops.needsUpdate = true;
  };

  const tmp = new THREE.Color();
  const edgeTmp = new THREE.Color();
  const shade = (L: RingLight) => {
    const cols = geo.getAttribute('color') as THREE.BufferAttribute;
    const edgeCols = edgeGeo.getAttribute('color') as THREE.BufferAttribute;
    for (let c = 0; c <= n; c++) {
      const az = ((c % n) * 360) / n;
      const b = ringShade(az, L);
      tmp.copy(base).multiplyScalar(b);
      // Top ridge edge: illuminated crest
      cols.setXYZ(2 * c, tmp.r, tmp.g, tmp.b);
      // Base: vertical depth falloff toward darker ground for natural perspective
      cols.setXYZ(2 * c + 1, tmp.r * 0.65, tmp.g * 0.65, tmp.b * 0.70);
      // Edge: a faint lighter line over the curtain, turning gold where the Sun hides.
      edgeTmp.copy(EDGE_GREY).multiplyScalar(Math.min(1, b));
      edgeTmp.lerp(tmp, 1 - edgeAlpha).lerp(GLOW, rimGlow(az, mask, L));
      edgeCols.setXYZ(c, edgeTmp.r, edgeTmp.g, edgeTmp.b);
    }
    cols.needsUpdate = true;
    edgeCols.needsUpdate = true;
  };

  update(k);
  shade({ fill: 1, sunAz: 0, sunEl: -90, sunDay: 0, earthAz: 0, earthLight: 0 });

  const group = new THREE.Group();
  group.add(mesh, edge);
  return {
    group,
    update,
    shade,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
    },
  };
}
