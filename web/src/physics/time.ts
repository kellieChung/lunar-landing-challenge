// Between hourly samples. Times are sample indices: t = 0 is the first
// sample, t = 1 the next; fractions are allowed. Same as python/lunar/metrics.py.

import type { Vec3 } from '../panorama3d/mapping';

export interface VectorSeries {
  e: ArrayLike<number>;
  n: ArrayLike<number>;
  u: ArrayLike<number>;
}

function bracket(t: number, count: number): [number, number] {
  const i0 = Math.min(Math.max(Math.floor(t), 0), count - 2);
  return [i0, t - i0];
}

/** Direction at fractional sample t: linear interpolation, then normalized. */
export function vectorAt(v: VectorSeries, t: number): Vec3 {
  const [i, f] = bracket(t, v.e.length);
  const e = (1 - f) * v.e[i] + f * v.e[i + 1];
  const n = (1 - f) * v.n[i] + f * v.n[i + 1];
  const u = (1 - f) * v.u[i] + f * v.u[i + 1];
  const len = Math.hypot(e, n, u);
  return [e / len, n / len, u / len];
}

/** A scalar series (e.g. Sun distance) at fractional sample t. */
export function valueAt(values: ArrayLike<number>, t: number): number {
  const [i, f] = bracket(t, values.length);
  return (1 - f) * values[i] + f * values[i + 1];
}

/** UTC date of fractional sample t. */
export function sampleDate(startIso: string, stepHours: number, t: number): Date {
  return new Date(Date.parse(startIso) + t * stepHours * 3600_000);
}
