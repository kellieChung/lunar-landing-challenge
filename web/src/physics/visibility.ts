// Visibility from the horizon mask: the only thing that decides "lit" or
// "Earth visible". Renderers show the result, they never compute it.
// Port of python/lunar/metrics.py (same definitions, same numbers).

import { maskAt, vecToAzEl } from '../panorama/geometry';
import { sunRadiusDeg } from './constants';

const RAD = Math.PI / 180;

/** Sunlit fraction that counts as "lit". */
export const LIT_THRESHOLD = 0.5;
/** Ring radius of the Sun-disk sample points, as a fraction of the Sun's angular radius. */
const DISK_RING = 1 / Math.SQRT2;
const RING_ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315]; // 0 = top of the disk
const N_DISK_POINTS = 1 + RING_ANGLES_DEG.length;

export interface AzEl {
  az: number; // deg, site frame
  el: number; // deg
}

/** True when a body's center is above the terrain horizon at its azimuth. */
export function bodyAboveHorizon(body: AzEl, mask: number[]): boolean {
  return body.el > maskAt(mask, body.az);
}

/** How far a direction is above the horizon at its azimuth (deg); < 0 = hidden. */
export function marginDeg(e: number, n: number, u: number, mask: number[]): number {
  const { az, el } = vecToAzEl(e, n, u);
  return el - maskAt(mask, az);
}

/** Fraction of the Sun's disk above the horizon (9-point sample): 0, 1/9, ..., 1. */
export function sunlitFraction(e: number, n: number, u: number, rAu: number, mask: number[]): number {
  const { az, el } = vecToAzEl(e, n, u);
  const ring = sunRadiusDeg(rAu) * DISK_RING;
  const cosEl = Math.cos(el * RAD);
  let count = el > maskAt(mask, az) ? 1 : 0;
  for (const deg of RING_ANGLES_DEG) {
    const a = deg * RAD;
    const pEl = el + ring * Math.cos(a);
    const pAz = az + (ring * Math.sin(a)) / cosEl; // degrees of azimuth shrink with elevation
    if (pEl > maskAt(mask, pAz)) count++;
  }
  return count / N_DISK_POINTS;
}
