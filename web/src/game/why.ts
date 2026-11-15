// "Why was it dark?": the longest stretch without the Sun at a spot, and what
// hid the Sun in the middle of it. Numbers from src/physics (the spot's
// horizon mask and the SPICE Sun vector in the spot's frame), never from the
// 3D render. Used by the reveal's ridge flash.

import type { GridPoint, SiteData } from '../data/types';
import { pointVectors } from '../physics/grid';
import type { SiteSeries } from '../physics/metrics';

export interface DarkWhy {
  start: number;
  end: number;
  mid: number;
  sunAz: number; // deg, 0 = north, 90 = east
  sunEl: number; // deg above the flat horizon
  ridgeEl: number; // deg: height of the terrain horizon toward the Sun
  cause: 'ridge' | 'below'; // a ridge in the way, or the Sun below the horizon itself
}

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassWord = (az: number) => DIRS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** The longest run of hours with the Sun hidden (lit = 0) in [from, to). */
export function longestDark(series: SiteSeries, from: number, to: number): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let h = Math.max(0, from);
  const end = Math.min(series.lit.length, to);
  while (h < end) {
    if (series.lit[h]) { h++; continue; }
    const s = h;
    while (h < end && !series.lit[h]) h++;
    if (!best || h - s > best.end - best.start) best = { start: s, end: h };
  }
  return best;
}

export function darkWhy(data: SiteData, p: GridPoint, series: SiteSeries, from: number, to: number): DarkWhy | null {
  const d = longestDark(series, from, to);
  if (!d) return null;
  const mid = Math.floor((d.start + d.end) / 2);
  const sun = pointVectors(data.sun, p.up_tilt);
  const az = (((Math.atan2(sun.e[mid], sun.n[mid]) * 180) / Math.PI) + 360) % 360;
  const ridgeEl = p.mask_deg[Math.round(az) % 360];
  const sunEl = series.sunEl[mid];
  return { ...d, mid, sunAz: az, sunEl, ridgeEl, cause: sunEl < -0.3 ? 'below' : 'ridge' }; // 0.3 deg: more than the Sun's radius
}

/** One plain sentence for the reveal. */
export function whySentence(w: DarkWhy, hourToDay: (h: number) => number): string {
  const d0 = hourToDay(w.start);
  const d1 = hourToDay(w.end);
  const span = d1 > d0 ? `From day ${d0} to day ${d1}` : `On day ${d0}`;
  if (w.cause === 'below') return `${span} the Sun dipped below the horizon itself, toward the ${compassWord(w.sunAz)}. No spot here could have caught it.`;
  return `${span} a ridge to the ${compassWord(w.sunAz)}, ${w.ridgeEl.toFixed(1)}° high, hid the Sun, which was only ${w.sunEl.toFixed(1)}° up.`;
}
