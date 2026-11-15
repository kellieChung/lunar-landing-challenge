// Connects the game rules to the real Moon: sunlight and Earth visibility per
// spot and hour from src/physics (horizon masks + SPICE vectors), slopes from
// the LOLA ground heights in sites.json. Only the ice amounts are made up
// (deposits.ts). No DOM here, so tests can run it on the shipped site files.

import type { GridPoint, GridSummary, SiteData } from '../data/types';
import { SOLAR_CONSTANT_W_M2 } from '../physics/constants';
import { pointVectors } from '../physics/grid';
import { fluxWm2, siteSeries, type SiteSeries } from '../physics/metrics';
import { SOLAR_TOWER_KW } from './constants';
import { craterSpots, iceTier, tieredIce, type IceTier } from './deposits';
import { buildTerrain } from './paths';
import type { Env } from './sim';
import { keyOf, type Key } from './state';
import { hasEarth, splitWindows, windowIndexAt, type SkyWindow } from './windows';

export type SeriesAt = (p: GridPoint) => SiteSeries;

/** Hourly lit / Earth series of any grid point, computed once per point. */
export function seriesCache(data: SiteData): SeriesAt {
  const cache = new Map<Key, SiteSeries>();
  return (p) => {
    const k = keyOf(p);
    let s = cache.get(k);
    if (!s) {
      s = siteSeries(pointVectors(data.sun, p.up_tilt), pointVectors(data.earth, p.up_tilt), p.mask_deg);
      cache.set(k, s);
    }
    return s;
  };
}

export interface World {
  env: Env;
  siteId: string;
  dark: Key[]; // spots with no sunlight all year (no part of the Sun's disk in any hour)
  craters: Key[]; // spots whose floor holds ice by the cold-trap tiers (rich or trace)
  ice: Map<Key, number>; // HYPOTHETICAL ice share of each crater
  /** REAL mean sunlit share of a crater floor over 2027 (from the hourly series). */
  floor(k: Key): number;
  tier(k: Key): IceTier;
  point(k: Key): GridPoint | undefined;
  summary(k: Key): GridSummary | undefined;
  series(k: Key): SiteSeries;
  /** Sun / Earth windows at a spot (cached). */
  windows(k: Key): SkyWindow[];
  keys: Key[]; // every grid spot
  hours: number; // hourly samples in the data (2027: 8760)
}

export function buildWorld(data: SiteData, summaries: GridSummary[], seriesAt: SeriesAt = seriesCache(data)): World {
  const points = new Map(data.grid.points.map((p) => [keyOf(p), p]));
  const sums = new Map(summaries.map((s) => [keyOf(s), s]));
  const terrain = buildTerrain(summaries);
  const series = (k: Key) => seriesAt(points.get(k)!);
  const meanSun = (k: Key) => {
    const f = series(k).fraction;
    let t = 0;
    for (let h = 0; h < f.length; h++) t += f[h];
    return t / f.length;
  };
  // sunlit_pct 0 only says the Sun never got halfway up; a spot can still see
  // the top of its disk. "Dark" means none of it, in any hour of 2027. Crater
  // tiers use the exact mean of the hourly series, not the rounded index value.
  const floors = new Map<Key, number>();
  for (const s of craterSpots(summaries)) {
    const k = keyOf(s);
    if (points.has(k)) floors.set(k, meanSun(k));
  }
  const dark = [...floors].filter(([, f]) => f === 0).map(([k]) => k);
  const ice = new Map<Key, number>();
  for (const [k, f] of floors) {
    const s = sums.get(k)!;
    const v = tieredIce(data.site.id, s.i, s.j, f);
    if (v > 0) ice.set(k, v);
  }
  const craters = [...ice.keys()];
  const darkSet = new Set(dark);
  const last = data.time.count - 1;
  const clamp = (h: number) => Math.min(Math.max(h, 0), last);
  const winCache = new Map<Key, SkyWindow[]>();
  const windows = (k: Key) => {
    let w = winCache.get(k);
    if (!w) {
      const s = series(k);
      w = splitWindows(s.lit, s.earth);
      winCache.set(k, w);
    }
    return w;
  };

  const env: Env = {
    // A Sun-tracking tower: rated power x how much of the Sun's disk is up x 1 / r^2.
    solarKw: (spot, hour) => {
      const s = series(spot);
      const h = clamp(hour);
      return SOLAR_TOWER_KW * (fluxWm2(s.rAu[h], s.fraction[h], s.sunEl[h]).tracking / SOLAR_CONSTANT_W_M2);
    },
    earthVisible: (spot, hour) => series(spot).earth[clamp(hour)] === 1,
    route: terrain.route,
    legKm: terrain.legKm,
    distanceKm: terrain.distanceKm,
    iceFraction: (spot) => ice.get(spot) ?? null,
    isDark: (spot) => darkSet.has(spot),
    isCrater: (spot) => ice.has(spot),
    earthHoursLeft: (spot, hour) => {
      const ws = windows(spot);
      const w = ws[windowIndexAt(ws, clamp(hour))];
      return hasEarth(w.kind) ? w.end - hour : 0;
    },
  };
  return {
    env, siteId: data.site.id, dark, craters, ice,
    floor: (k) => floors.get(k) ?? meanSun(k),
    tier: (k) => (ice.has(k) ? iceTier(floors.get(k)!) : 'none'),
    point: (k) => points.get(k), summary: (k) => sums.get(k), series, windows,
    keys: [...points.keys()].filter((k) => sums.has(k)),
    hours: data.time.count,
  };
}
