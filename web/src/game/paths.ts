// Rover routes between grid spots. A rover may step to any of the 8
// neighbouring spots if the slope between them (from the real LOLA ground
// heights in sites.json) is within its limit. Heights are only known every
// 1 km here, so this is a coarse check: real route planning uses finer maps.

import type { GridSummary } from '../data/types';
import { MAX_SLOPE_DEG } from './constants';
import { keyOf, type Key } from './state';

export interface Route {
  keys: Key[]; // from start to goal, both included
  km: number;
}

export interface Terrain {
  /** Length of the step between two neighbouring spots (km), or null if too steep / not neighbours. */
  legKm(a: Key, b: Key): number | null;
  /** Shortest drivable route, or null if there is none. */
  route(from: Key, to: Key): Route | null;
  /** Straight-line distance between two spots (km). */
  distanceKm(a: Key, b: Key): number;
}

/** Slope (deg) of a straight line between two heights `runKm` apart. */
export function slopeDeg(riseM: number, runKm: number): number {
  return (Math.atan(Math.abs(riseM) / (runKm * 1000)) * 180) / Math.PI;
}

export function buildTerrain(summaries: GridSummary[], maxSlopeDeg = MAX_SLOPE_DEG): Terrain {
  const spots = new Map(summaries.map((s) => [keyOf(s), s]));
  const at = new Map(summaries.map((s) => [`${s.dx_km},${s.dy_km}`, s]));
  const steps = [...new Set(summaries.map((s) => s.dx_km))].sort((a, b) => a - b);
  const spacing = steps.length > 1 ? steps[1] - steps[0] : 1;

  const legKm = (a: Key, b: Key): number | null => {
    const p = spots.get(a);
    const q = spots.get(b);
    if (!p || !q) return null;
    const dx = q.dx_km - p.dx_km;
    const dy = q.dy_km - p.dy_km;
    if ((dx === 0 && dy === 0) || Math.abs(dx) > spacing + 1e-9 || Math.abs(dy) > spacing + 1e-9) return null;
    const km = Math.hypot(dx, dy);
    return slopeDeg(q.ground_m - p.ground_m, km) <= maxSlopeDeg ? km : null;
  };

  const neighbours = (k: Key): Key[] => {
    const p = spots.get(k)!;
    const out: Key[] = [];
    for (const dx of [-spacing, 0, spacing]) {
      for (const dy of [-spacing, 0, spacing]) {
        const q = at.get(`${p.dx_km + dx},${p.dy_km + dy}`);
        if (q && q !== p) out.push(keyOf(q));
      }
    }
    return out;
  };

  const cache = new Map<string, Route | null>();
  // Dijkstra; the grid has at most 121 spots, so a plain scan for the nearest is fine.
  const route = (from: Key, to: Key): Route | null => {
    const id = `${from}>${to}`;
    if (cache.has(id)) return cache.get(id)!;
    let found: Route | null = null;
    if (spots.has(from) && spots.has(to)) {
      const dist = new Map<Key, number>([[from, 0]]);
      const prev = new Map<Key, Key>();
      const done = new Set<Key>();
      for (;;) {
        let cur: Key | null = null;
        for (const [k, d] of dist) if (!done.has(k) && (cur === null || d < dist.get(cur)!)) cur = k;
        if (cur === null) break;
        if (cur === to) {
          const keys = [to];
          while (keys[0] !== from) keys.unshift(prev.get(keys[0])!);
          found = { keys, km: dist.get(to)! };
          break;
        }
        done.add(cur);
        for (const nb of neighbours(cur)) {
          const leg = legKm(cur, nb);
          if (leg === null) continue;
          const d = dist.get(cur)! + leg;
          if (d < (dist.get(nb) ?? Infinity)) {
            dist.set(nb, d);
            prev.set(nb, cur);
          }
        }
      }
    }
    cache.set(id, found);
    return found;
  };

  const distanceKm = (a: Key, b: Key): number => {
    const p = spots.get(a);
    const q = spots.get(b);
    return p && q ? Math.hypot(q.dx_km - p.dx_km, q.dy_km - p.dy_km) : Infinity;
  };

  return { legKm, route, distanceKm };
}
