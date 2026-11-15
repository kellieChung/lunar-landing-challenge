// Visibility from the horizon mask: the only thing that decides "lit" or
// "Earth visible". Renderers show the result, they never compute it.
// Port of python/lunar/metrics.py (same definitions, same numbers).

import { maskAt, vecToAzEl } from '../panorama/geometry';
import { AU_KM, R_EARTH_KM, R_SUN_KM, sunRadiusDeg } from './constants';

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

/**
 * Share of the Sun's disk not covered by Earth's disk: 1 = no eclipse,
 * 0 = total. (What Earth calls a lunar eclipse is, from the Moon, Earth
 * passing in front of the Sun.) Both are flat disks of angular radius a
 * (Sun) and b (Earth) with centers d apart; the covered part is the lens
 * where they overlap. Port of eclipse_share in python/lunar/metrics.py.
 */
export function eclipseShare(
  se: number, sn: number, su: number, rAu: number,
  ee: number, en: number, eu: number, rKm: number,
): number {
  const cosD = (se * ee + sn * en + su * eu)
    / (Math.sqrt(se * se + sn * sn + su * su) * Math.sqrt(ee * ee + en * en + eu * eu));
  const d = Math.acos(Math.min(1, Math.max(-1, cosD)));
  const a = Math.asin(R_SUN_KM / (rAu * AU_KM));
  const b = Math.asin(R_EARTH_KM / rKm);
  if (d <= b - a) return 0;
  if (d >= a + b) return 1;
  const lens = a * a * Math.acos((d * d + a * a - b * b) / (2 * d * a))
    + b * b * Math.acos((d * d + b * b - a * a) / (2 * d * b))
    - 0.5 * Math.sqrt((-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b));
  return 1 - lens / (Math.PI * a * a);
}
