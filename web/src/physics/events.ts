// Sunrise, sunset, Earthrise, Earthset between hourly samples. Port of
// python/lunar/metrics.py (next_flip / next_change). The same state function
// decides "lit now" and finds the events, so jumping to a sunrise always
// lands on a lit moment.

import { valueAt, vectorAt, type VectorSeries } from './time';
import type { SunSeries } from './metrics';
import { LIT_THRESHOLD, marginDeg, sunlitFraction } from './visibility';

const EPS_SAMPLES = 1e-6; // "strictly after"
const BISECT_STEPS = 40; // halves one hour 40 times: far below a second

export type StateAt = (t: number) => boolean;

/** Is the Sun lit (fraction >= 0.5) at fractional sample t? */
export function sunLitAt(sun: SunSeries, mask: number[], t: number): boolean {
  const [e, n, u] = vectorAt(sun, t);
  return sunlitFraction(e, n, u, valueAt(sun.r_au, t), mask) >= LIT_THRESHOLD;
}

/** Is Earth's center above the horizon at fractional sample t? */
export function earthVisibleAt(earth: VectorSeries, mask: number[], t: number): boolean {
  const [e, n, u] = vectorAt(earth, t);
  return marginDeg(e, n, u, mask) > 0;
}

function bisect(stateAt: StateAt, s0: boolean, lo: number, hi: number): [number, number] {
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = 0.5 * (lo + hi);
    if (stateAt(mid) === s0) lo = mid;
    else hi = mid;
  }
  return [lo, hi];
}

/**
 * First time after s when the state differs from its value at s, or null.
 * hourly[j] = state at sample j. A flip that reverts within one hour is not seen.
 */
export function nextFlip(stateAt: StateAt, hourly: ArrayLike<number>, s: number): number | null {
  const s0 = stateAt(s);
  for (let j = Math.floor(s) + 1; j < hourly.length; j++) {
    if (Boolean(hourly[j]) !== s0) return bisect(stateAt, s0, Math.max(s, j - 1), j)[1];
  }
  return null;
}

/** First time strictly after t when the state becomes toState, or null. */
export function nextChange(stateAt: StateAt, hourly: ArrayLike<number>, t: number, toState: boolean): number | null {
  let s: number | null = t + EPS_SAMPLES;
  if (s > hourly.length - 1) return null;
  if (stateAt(s) === toState) {
    s = nextFlip(stateAt, hourly, s);
    if (s === null) return null;
  }
  return nextFlip(stateAt, hourly, s);
}

/**
 * When the current state began: the earliest time of the run that contains t,
 * or 0 if it has lasted since the first sample. (Used for "dark for N hours".)
 */
export function stateSince(stateAt: StateAt, hourly: ArrayLike<number>, t: number): number {
  const s0 = stateAt(t);
  for (let j = Math.ceil(t) - 1; j >= 0; j--) {
    if (Boolean(hourly[j]) !== s0) return bisect(stateAt, !s0, j, Math.min(t, j + 1))[1];
  }
  return 0;
}
