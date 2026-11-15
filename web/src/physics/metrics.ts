// Hourly series and window metrics. Port of python/lunar/metrics.py; the
// shared fixture python/tests/fixtures/metrics_parity.json checks they agree.
// Float64Array throughout, to match numpy.

import { vecToAzEl } from '../panorama/geometry';
import { SOLAR_CONSTANT_W_M2 } from './constants';
import type { VectorSeries } from './time';
import { eclipseShare, LIT_THRESHOLD, marginDeg, sunlitFraction } from './visibility';

const RAD = Math.PI / 180;

export type SunSeries = VectorSeries & { r_au: ArrayLike<number> };
/** Earth directions; with r_km (Earth distance) eclipses of the Sun by Earth are counted. */
export type EarthSeries = VectorSeries & { r_km?: ArrayLike<number> };

export interface SiteSeries {
  count: number;
  fraction: Float64Array; // sunlit fraction 0..1 (terrain only)
  eclipse: Float64Array; // share of the Sun not covered by Earth: 1 = no eclipse (scales flux only)
  sunEl: Float64Array; // deg
  earthMargin: Float64Array; // deg above the horizon (< 0 hidden)
  rAu: Float64Array;
  lit: Uint8Array; // 1 = fraction >= 0.5
  earth: Uint8Array; // 1 = Earth's center above the horizon
}

export interface Flux {
  tracking: number;
  vertical: number;
  horizontal: number;
}

export interface WindowMetrics {
  samples: number;
  sunlit_pct: number;
  mean_sunlit_fraction: number;
  earth_pct: number;
  both_pct: number;
  longest_dark_h: number;
  longest_blackout_h: number;
  mean_flux_w_m2: Flux;
}

/**
 * Solar power per square metre of panel for the three panel types.
 * eclipse: share of the Sun not covered by Earth (eclipseShare); 1 = none.
 */
export function fluxWm2(rAu: number, fraction: number, sunElDeg: number, eclipse = 1): Flux {
  const full = (SOLAR_CONSTANT_W_M2 / (rAu * rAu)) * fraction * eclipse;
  const el = sunElDeg * RAD;
  return { tracking: full, vertical: full * Math.cos(el), horizontal: full * Math.max(0, Math.sin(el)) };
}

/** Per-sample visibility for one grid point. */
export function siteSeries(sun: SunSeries, earth: EarthSeries, mask: number[]): SiteSeries {
  const count = sun.e.length;
  const s: SiteSeries = {
    count,
    fraction: new Float64Array(count),
    eclipse: new Float64Array(count).fill(1),
    sunEl: new Float64Array(count),
    earthMargin: new Float64Array(count),
    rAu: Float64Array.from(sun.r_au),
    lit: new Uint8Array(count),
    earth: new Uint8Array(count),
  };
  for (let k = 0; k < count; k++) {
    s.sunEl[k] = vecToAzEl(sun.e[k], sun.n[k], sun.u[k]).el;
    s.fraction[k] = sunlitFraction(sun.e[k], sun.n[k], sun.u[k], sun.r_au[k], mask);
    s.earthMargin[k] = marginDeg(earth.e[k], earth.n[k], earth.u[k], mask);
    if (earth.r_km) {
      s.eclipse[k] = eclipseShare(sun.e[k], sun.n[k], sun.u[k], sun.r_au[k], earth.e[k], earth.n[k], earth.u[k], earth.r_km[k]);
    }
    s.lit[k] = s.fraction[k] >= LIT_THRESHOLD ? 1 : 0;
    s.earth[k] = s.earthMargin[k] > 0 ? 1 : 0;
  }
  return s;
}

/** Longest run of samples i in [start, end) where pred(i) is true. */
function longestRun(start: number, end: number, pred: (i: number) => boolean): number {
  let best = 0;
  let run = 0;
  for (let i = start; i < end; i++) {
    run = pred(i) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Summary numbers for samples start .. start+length-1. Dark and blackout
 * stretches are clipped to the window.
 */
export function windowMetrics(s: SiteSeries, start: number, length: number, stepHours = 1): WindowMetrics {
  const end = Math.min(start + length, s.count);
  const n = end - start;
  let lit = 0;
  let earth = 0;
  let both = 0;
  let frac = 0;
  const flux: Flux = { tracking: 0, vertical: 0, horizontal: 0 };
  for (let i = start; i < end; i++) {
    lit += s.lit[i];
    earth += s.earth[i];
    both += s.lit[i] & s.earth[i];
    frac += s.fraction[i];
    const f = fluxWm2(s.rAu[i], s.fraction[i], s.sunEl[i], s.eclipse[i]);
    flux.tracking += f.tracking;
    flux.vertical += f.vertical;
    flux.horizontal += f.horizontal;
  }
  return {
    samples: n,
    sunlit_pct: (100 * lit) / n,
    mean_sunlit_fraction: frac / n,
    earth_pct: (100 * earth) / n,
    both_pct: (100 * both) / n,
    longest_dark_h: longestRun(start, end, (i) => !s.lit[i]) * stepHours,
    longest_blackout_h: longestRun(start, end, (i) => !s.earth[i]) * stepHours,
    mean_flux_w_m2: { tracking: flux.tracking / n, vertical: flux.vertical / n, horizontal: flux.horizontal / n },
  };
}
