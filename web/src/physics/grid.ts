// Grid points around a site (port of python/lunar/grid.py). The Sun/Earth
// vectors in the site file are for the site center, in the site frame; at a
// grid point we rotate them into that point's own (east, north, up), using its
// up_tilt (the point's up written in the site frame as [east, north] parts).
// Then every visibility and metrics function works unchanged.

import type { GridPoint } from '../data/types';
import type { VectorSeries } from './time';

type V3 = [number, number, number];

/** Orthonormal (east, north, up) of a grid point, written in the site frame. */
export function pointAxes(tilt: readonly [number, number]): [V3, V3, V3] {
  const [te, tn] = tilt;
  const up: V3 = [te, tn, Math.sqrt(1 - te * te - tn * tn)];
  const raw: V3 = [1 - te * up[0], -te * up[1], -te * up[2]]; // site east minus its up part
  const len = Math.sqrt(raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2]);
  const east: V3 = [raw[0] / len, raw[1] / len, raw[2] / len];
  const north: V3 = [ // up x east
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  return [east, north, up];
}

/**
 * The same series seen from a grid point: each vector rotated into the
 * point's frame. Other fields (r_au, r_km) are copied as they are. Tilt
 * (0, 0) returns the input unchanged.
 */
export function pointVectors<T extends VectorSeries>(v: T, tilt: readonly [number, number]): T {
  if (tilt[0] === 0 && tilt[1] === 0) return v;
  const [east, north, up] = pointAxes(tilt);
  const count = v.e.length;
  const e = new Float64Array(count);
  const n = new Float64Array(count);
  const u = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const a = v.e[k];
    const b = v.n[k];
    const c = v.u[k];
    // Same order of operations as python/lunar/grid.py, for identical numbers.
    e[k] = a * east[0] + b * east[1] + c * east[2];
    n[k] = a * north[0] + b * north[1] + c * north[2];
    u[k] = a * up[0] + b * up[1] + c * up[2];
  }
  return { ...v, e, n, u };
}

/** The grid point for "?pt=i,j" (default and fallback: the site center). */
export function findPoint(points: GridPoint[], pt: string | null): GridPoint {
  const center = points.find((p) => p.dx_km === 0 && p.dy_km === 0) ?? points[0];
  const m = pt?.match(/^(-?\d+),(-?\d+)$/);
  if (!m) return center;
  const i = Number(m[1]);
  const j = Number(m[2]);
  return points.find((p) => p.i === i && p.j === j) ?? center;
}

/** "2 km E, 1 km N of the site center", or "Site center". */
export function describeOffset(dxKm: number, dyKm: number): string {
  if (dxKm === 0 && dyKm === 0) return 'Site center';
  const part = (v: number, pos: string, neg: string) => (v === 0 ? null : `${Math.abs(v)} km ${v > 0 ? pos : neg}`);
  return `${[part(dxKm, 'E', 'W'), part(dyKm, 'N', 'S')].filter(Boolean).join(', ')} of the site center`;
}
