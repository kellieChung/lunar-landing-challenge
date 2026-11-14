// Near-field heightmap (<site_id>_terrain.bin): parsing and pure geometry.
// Rendering only: physics never reads it. See python/lunar/terrain.py.

import type { TerrainHeader } from '../data/types';
import { maskAt, wrapDeg } from '../panorama/geometry';

const RAD = Math.PI / 180;

export interface Heightmap {
  nx: number;
  ny: number;
  spacing: number; // m
  x0: number; // m, east of column 0
  y0: number; // m, north of row 0
  z: Float32Array; // row-major, z[j * nx + i], m relative to the observer's ground
}

/** Decode the little-endian file described by its header (float32, or int16 times scale_m). */
export function parseTerrain(buf: ArrayBuffer, h: TerrainHeader): Heightmap {
  const n = h.nx * h.ny;
  const bytes = h.format === 'float32-le' ? 4 : h.format === 'int16-le' ? 2 : 0;
  if (!bytes) throw new Error(`Unknown terrain format ${h.format}`);
  if (buf.byteLength !== n * bytes) {
    throw new Error(`Terrain file is ${buf.byteLength} bytes, expected ${n * bytes} (${h.nx} x ${h.ny} ${h.format})`);
  }
  const view = new DataView(buf);
  const z = new Float32Array(n);
  if (bytes === 4) {
    for (let i = 0; i < n; i++) z[i] = view.getFloat32(i * 4, true);
  } else {
    const scale = h.scale_m;
    if (!scale) throw new Error('int16-le terrain needs scale_m');
    for (let i = 0; i < n; i++) z[i] = view.getInt16(i * 2, true) * scale;
  }
  return { nx: h.nx, ny: h.ny, spacing: h.spacing_m, x0: h.x0_m, y0: h.y0_m, z };
}

const R_MOON_M = 1737400; // the maps' datum sphere

/**
 * Move the heightmap's origin to a grid point (dx, dy metres from the site
 * center) and re-level it for that point: heights become relative to the
 * point's ground and measured along (nearly) its own up. Flat ground then
 * curves away from the new observer exactly as it did from the center:
 *
 *   z'(r') = z(p + r') - z(p) + r'.p / (R + g)      (r' = position from the point)
 *
 * The point must sit on a vertex (whole-km grid points on the 100 m grid
 * do), so z(p) is an exact DEM value, not an interpolation.
 */
export function recenter(t: Heightmap, dxM: number, dyM: number, groundM = 0): Heightmap {
  if (dxM === 0 && dyM === 0) return t;
  const ip = Math.round((dxM - t.x0) / t.spacing);
  const jp = Math.round((dyM - t.y0) / t.spacing);
  if (Math.abs(t.x0 + ip * t.spacing - dxM) > 1e-6 || Math.abs(t.y0 + jp * t.spacing - dyM) > 1e-6
    || ip < 0 || jp < 0 || ip >= t.nx || jp >= t.ny) {
    throw new Error(`Grid point (${dxM}, ${dyM}) m is not a vertex of the heightmap`);
  }
  const zp = t.z[jp * t.nx + ip];
  const base = R_MOON_M + groundM;
  const z = new Float32Array(t.z.length);
  for (let j = 0; j < t.ny; j++) {
    const ry = t.y0 + j * t.spacing - dyM;
    for (let i = 0; i < t.nx; i++) {
      const rx = t.x0 + i * t.spacing - dxM;
      const v = j * t.nx + i;
      z[v] = t.z[v] - zp + (rx * dxM + ry * dyM) / base;
    }
  }
  return { ...t, x0: t.x0 - dxM, y0: t.y0 - dyM, z };
}

/**
 * The square of vertices within halfM of the origin (both axes). The
 * origin must be a vertex, so the result is centered exactly like the
 * original 10 x 10 km export.
 */
export function crop(t: Heightmap, halfM: number): Heightmap {
  const i0 = Math.max(0, Math.ceil((-halfM - t.x0) / t.spacing - 1e-9));
  const i1 = Math.min(t.nx - 1, Math.floor((halfM - t.x0) / t.spacing + 1e-9));
  const j0 = Math.max(0, Math.ceil((-halfM - t.y0) / t.spacing - 1e-9));
  const j1 = Math.min(t.ny - 1, Math.floor((halfM - t.y0) / t.spacing + 1e-9));
  const nx = i1 - i0 + 1;
  const ny = j1 - j0 + 1;
  if (nx === t.nx && ny === t.ny) return t;
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) z.set(t.z.subarray((j0 + j) * t.nx + i0, (j0 + j) * t.nx + i0 + nx), j * nx);
  return { nx, ny, spacing: t.spacing, x0: t.x0 + i0 * t.spacing, y0: t.y0 + j0 * t.spacing, z };
}

/** Bilinear height (m) at (x east, y north); NaN outside the grid. */
export function heightAt(t: Heightmap, x: number, y: number): number {
  const fi = (x - t.x0) / t.spacing;
  const fj = (y - t.y0) / t.spacing;
  if (fi < 0 || fj < 0 || fi > t.nx - 1 || fj > t.ny - 1) return NaN;
  const i0 = Math.min(Math.floor(fi), t.nx - 2);
  const j0 = Math.min(Math.floor(fj), t.ny - 2);
  const a = fi - i0;
  const b = fj - j0;
  const z = (i: number, j: number) => t.z[j * t.nx + i];
  return (z(i0, j0) * (1 - a) * (1 - b) + z(i0 + 1, j0) * a * (1 - b)
    + z(i0, j0 + 1) * (1 - a) * b + z(i0 + 1, j0 + 1) * a * b);
}

/**
 * Vertex positions in three.js axes at true scale with the eye at the origin:
 * (x east, z - mast, -y north). The scene scales y by k afterwards.
 */
export function terrainPositions(t: Heightmap, mastM: number): Float32Array {
  const out = new Float32Array(t.nx * t.ny * 3);
  for (let j = 0; j < t.ny; j++) {
    for (let i = 0; i < t.nx; i++) {
      const v = j * t.nx + i;
      out[v * 3] = t.x0 + i * t.spacing;
      out[v * 3 + 1] = t.z[v] - mastM;
      out[v * 3 + 2] = -(t.y0 + j * t.spacing);
    }
  }
  return out;
}

/** Cell index range [i0, i1) x [j0, j1) to leave out of a mesh. */
export interface Hole {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/**
 * Two triangles per cell, wound so their normals point up (+y). Cells inside
 * `hole` are left out (where the detail patch is drawn instead).
 */
export function terrainIndex(nx: number, ny: number, hole?: Hole | null): Uint32Array {
  const holeCells = hole ? Math.max(0, hole.i1 - hole.i0) * Math.max(0, hole.j1 - hole.j0) : 0;
  const out = new Uint32Array(((nx - 1) * (ny - 1) - holeCells) * 6);
  let k = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (hole && i >= hole.i0 && i < hole.i1 && j >= hole.j0 && j < hole.j1) continue;
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      out.set([a, b, c, b, d, c], k);
      k += 6;
    }
  }
  return out;
}

/**
 * Never let the mesh rise above the physics horizon: any vertex seen higher
 * than the mask at its azimuth is lowered onto it. Within nearLimitM the limit
 * is the near band (0-5 km); farther out (the square's corners) the full mask.
 * Works on terrainPositions output (eye at origin, true scale). Returns the
 * number of vertices moved.
 */
export function clampToMask(pos: Float32Array, nearMask: number[], mask: number[], nearLimitM = 5000): number {
  let moved = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const north = -pos[v * 3 + 2];
    const d = Math.hypot(x, north);
    if (d < 1) continue; // the observer's own vertex
    const az = wrapDeg(Math.atan2(x, north) / RAD);
    const limit = maskAt(d <= nearLimitM ? nearMask : mask, az);
    if (Math.atan2(y, d) / RAD > limit) {
      pos[v * 3 + 1] = d * Math.tan(limit * RAD);
      moved++;
    }
  }
  return moved;
}

/**
 * Height (m) on the drawn mesh at (x east, y north): the same two triangles
 * per cell that terrainIndex builds (split along the b-c diagonal), so things
 * placed with it sit exactly on the rendered ground. NaN outside the grid.
 */
export function heightOnMesh(t: Heightmap, x: number, y: number): number {
  const fi = (x - t.x0) / t.spacing;
  const fj = (y - t.y0) / t.spacing;
  if (fi < 0 || fj < 0 || fi > t.nx - 1 || fj > t.ny - 1) return NaN;
  const i0 = Math.min(Math.floor(fi), t.nx - 2);
  const j0 = Math.min(Math.floor(fj), t.ny - 2);
  const u = fi - i0;
  const v = fj - j0;
  const z = (i: number, j: number) => t.z[j * t.nx + i];
  const za = z(i0, j0);
  const zb = z(i0 + 1, j0);
  const zc = z(i0, j0 + 1);
  const zd = z(i0 + 1, j0 + 1);
  if (u + v <= 1) return za + u * (zb - za) + v * (zc - za); // triangle a, b, c
  return zd + (1 - u) * (zc - zd) + (1 - v) * (zb - zd); // triangle b, d, c
}

/**
 * The coarse cells covered by a detail patch, or null if the patch's edges
 * don't fall on the coarse grid lines (then the patch can't be stitched in).
 */
export function patchHole(coarse: Heightmap, patch: Heightmap): Hole | null {
  const xMax = patch.x0 + (patch.nx - 1) * patch.spacing;
  const yMax = patch.y0 + (patch.ny - 1) * patch.spacing;
  const fi0 = (patch.x0 - coarse.x0) / coarse.spacing;
  const fi1 = (xMax - coarse.x0) / coarse.spacing;
  const fj0 = (patch.y0 - coarse.y0) / coarse.spacing;
  const fj1 = (yMax - coarse.y0) / coarse.spacing;
  const whole = (f: number) => Math.abs(f - Math.round(f)) < 1e-6;
  if (![fi0, fi1, fj0, fj1].every(whole)) return null;
  const hole = { i0: Math.round(fi0), i1: Math.round(fi1), j0: Math.round(fj0), j1: Math.round(fj1) };
  if (hole.i0 < 0 || hole.j0 < 0 || hole.i1 > coarse.nx - 1 || hole.j1 > coarse.ny - 1) return null;
  return hole;
}

/**
 * Fit a detail patch into the coarse mesh around it. The patch's outer ring
 * of vertices is put exactly on the coarse triangles' edges (so there are no
 * cracks), and the outer `featherM` blends from the coarse surface to the
 * patch's own heights (so there is no step). Returns a new heightmap.
 */
export function stitchToCoarse(patch: Heightmap, coarse: Heightmap, featherM = 200): Heightmap {
  const xMax = patch.x0 + (patch.nx - 1) * patch.spacing;
  const yMax = patch.y0 + (patch.ny - 1) * patch.spacing;
  const z = new Float32Array(patch.z);
  for (let j = 0; j < patch.ny; j++) {
    const y = patch.y0 + j * patch.spacing;
    for (let i = 0; i < patch.nx; i++) {
      const x = patch.x0 + i * patch.spacing;
      const edge = Math.min(x - patch.x0, xMax - x, y - patch.y0, yMax - y);
      if (edge >= featherM) continue;
      const zc = heightOnMesh(coarse, x, y);
      if (!Number.isFinite(zc)) continue;
      const w = Math.max(0, edge / featherM);
      const v = j * patch.nx + i;
      z[v] = w * patch.z[v] + (1 - w) * zc;
    }
  }
  return { ...patch, z };
}

/** Planar texture coordinates: one texture repeat every `repeatM` metres. */
export function terrainUVs(t: Heightmap, repeatM = 60): Float32Array {
  const out = new Float32Array(t.nx * t.ny * 2);
  for (let j = 0; j < t.ny; j++) {
    for (let i = 0; i < t.nx; i++) {
      const v = j * t.nx + i;
      out[v * 2] = (t.x0 + i * t.spacing) / repeatM;
      out[v * 2 + 1] = (t.y0 + j * t.spacing) / repeatM;
    }
  }
  return out;
}

/** Deterministic pseudo-random value in [0, 1) for an integer lattice point. */
function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) at (x, y) metres with the given cell size. */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx - i);
  const v = s(fy - j);
  const a = hash2(i, j, seed);
  const b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed);
  const d = hash2(i + 1, j + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * Gentle large-scale brightness mottling (grey RGB per vertex, 0.72-1.0),
 * so the ground doesn't look like one flat material. Rendering only.
 */
export function terrainColors(t: Heightmap): Float32Array {
  const out = new Float32Array(t.nx * t.ny * 3);
  for (let j = 0; j < t.ny; j++) {
    for (let i = 0; i < t.nx; i++) {
      const x = t.x0 + i * t.spacing;
      const y = t.y0 + j * t.spacing;
      const n = 0.65 * valueNoise(x, y, 900, 1) + 0.35 * valueNoise(x, y, 260, 2);
      const g = 0.72 + 0.28 * n;
      out.set([g, g, g], (j * t.nx + i) * 3);
    }
  }
  return out;
}
