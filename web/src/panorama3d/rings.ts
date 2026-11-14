// Skyline rings: curtains around the eye whose top edge at each azimuth sits
// exactly at a horizon-mask elevation (shown with the stretch k). Drawn far to
// near, so what you see on top is max(bands) = mask_deg, the physics horizon.

import * as THREE from 'three';
import { exaggerateEl } from './mapping';

const RAD = Math.PI / 180;
const MIN_TRUE_DEG = -89; // "no terrain" (-90) and anything below is pulled up to this

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
  setColor(color: THREE.ColorRepresentation): void;
  dispose(): void;
}

/**
 * One ring: a flat, unlit curtain plus a brighter edge line along its top.
 * Backdrop objects never depth-test; `order` sets the draw order (far first).
 */
export function buildRing(mask: number[], k: number, radius: number, color: number, edgeAlpha: number, order: number): Ring {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ringPositions(mask, k, radius), 3));
  geo.setIndex(ringIndex(mask.length));
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;

  const edgeGeo = new THREE.BufferGeometry();
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xc8ccd4, transparent: true, opacity: edgeAlpha, depthTest: false, depthWrite: false,
  });
  const edge = new THREE.Line(edgeGeo, edgeMat);
  edge.renderOrder = order + 0.5;
  edge.frustumCulled = false;

  const update = (kk: number) => {
    const pos = ringPositions(mask, kk, radius);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tops = new Float32Array((mask.length + 1) * 3);
    for (let c = 0; c <= mask.length; c++) tops.set(pos.subarray(c * 6, c * 6 + 3), c * 3);
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(tops, 3));
  };
  update(k);

  const group = new THREE.Group();
  group.add(mesh, edge);
  return {
    group,
    update,
    setColor: (c) => mat.color.set(c),
    dispose: () => {
      geo.dispose();
      mat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
    },
  };
}
