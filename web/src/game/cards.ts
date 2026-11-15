// The look-and-compare choices of a run: which landing spot, which crater,
// where a solar tower goes. Pure functions of the game state and the real
// data. Options are drawn so that none beats the others on every REAL metric
// (game.MD v3 §5); which one is actually best is left to the projection.

import type { GridSummary } from '../data/types';
import { CABLE_REACH_KM, ROVER_BATTERY_KWH, RUN_DEADLINE_H } from './constants';
import { craterSpots } from './deposits';
import type { World } from './env';
import { buildTerrain } from './paths';
import { chooseCrater, deliver, land, reachableDark, tripHours, tripNeedKWh, type Env } from './sim';
import { keyOf, type GameState, type Key } from './state';
import { windowIndexAt, type SkyWindow } from './windows';

export type Card =
  | { kind: 'land'; spot: Key; role: LandRole }
  | { kind: 'crater'; target: Key }
  | { kind: 'tower'; spot: Key };

export type LandRole = 'sun' | 'earth' | 'balanced'; // 'balanced' = the spot closest to ice

/** Craters (reachable icy floors) named A, B, C... by driving distance from the base. */
export function craterNames(env: Env, base: Key, craters: Key[]): Map<Key, string> {
  const reach = reachableDark(env, base, craters).sort((a, b) => env.route(base, a)!.km - env.route(base, b)!.km);
  return new Map(reach.map((k, i) => [k, `Crater ${String.fromCharCode(65 + (i % 26))}`]));
}

/** Put a card into effect. Returns false if the rules refused it. */
export function playCard(s: GameState, env: Env, craters: Key[], card: Card): boolean {
  switch (card.kind) {
    case 'land': return land(s, env, card.spot, craters).ok;
    case 'crater': return chooseCrater(s, env, card.target).ok;
    case 'tower': return deliver(s, env, 'tower', card.spot).ok;
  }
}

/** The REAL numbers a landing spot is judged on in the reveal. */
export interface SpotMetrics {
  sun: number; // % of 2027 sunlit
  earth: number; // % of 2027 with Earth in view
  night: number; // longest dark stretch, hours
  iceKm: number; // driving distance to the nearest icy crater a rover can reach
}

export function spotMetrics(w: World, k: Key): SpotMetrics {
  const s = w.summary(k)!;
  const km = reachableDark(w.env, k, w.craters).map((c) => w.env.route(k, c)!.km);
  return { sun: s.sunlit_pct, earth: s.earth_pct, night: s.longest_dark_h, iceKm: km.length ? Math.min(...km) : Infinity };
}

/** Does a beat b on every metric (and strictly on at least one)? */
export function dominates(a: SpotMetrics, b: SpotMetrics): boolean {
  const ge = a.sun >= b.sun && a.earth >= b.earth && a.night <= b.night && a.iceKm <= b.iceKm + 1e-9;
  return ge && (a.sun > b.sun || a.earth > b.earth || a.night < b.night || a.iceKm < b.iceKm - 1e-9);
}

/** Spots a base could land on: some sun, not a crater floor, an icy crater in rover range. */
export function landable(w: World): Key[] {
  return w.keys.filter((k) => !w.env.isDark(k) && !w.env.isCrater(k) && reachableDark(w.env, k, w.craters).length > 0);
}

/**
 * Three landing spots in three roles: the sunniest, the best Earth view, and a
 * balanced spot with a short night. `rand` (0..1) varies which of the top few
 * fill each role between runs. A spot that another beats on all three metrics
 * is swapped for the next candidate of its role. Picks are at least 2 km apart
 * so that going to look shows a different skyline.
 */
export function landingCards(w: World, rand: () => number = () => 0): Card[] {
  const opts = landable(w).map((k) => ({ k, m: spotMetrics(w, k) }));
  const order: Record<LandRole, typeof opts> = {
    sun: [...opts].sort((a, b) => b.m.sun - a.m.sun || a.m.night - b.m.night),
    earth: [...opts].sort((a, b) => b.m.earth - a.m.earth || b.m.sun - a.m.sun),
    balanced: [...opts].sort((a, b) => a.m.iceKm - b.m.iceKm || b.m.sun + b.m.earth - (a.m.sun + a.m.earth)),
  };
  const roles: LandRole[] = ['sun', 'earth', 'balanced'];
  const picked: { k: Key; m: SpotMetrics; role: LandRole }[] = [];
  const farEnough = (k: Key) => picked.every((p) => w.env.distanceKm(p.k, k) >= 2 - 1e-9);
  for (const role of roles) {
    const pool = order[role].filter((o) => farEnough(o.k));
    const top = pool.slice(0, 3);
    const o = top[Math.min(top.length - 1, Math.floor(rand() * top.length))] ?? pool[0];
    if (o) picked.push({ ...o, role });
  }
  // Swap out any dominated pick: first for the next candidate of its role, then
  // for any candidate that trades off against the other two (closer spacing
  // allowed as a last resort).
  for (let pass = 0; pass < 8; pass++) {
    const bad = picked.findIndex((p) => picked.some((q) => q !== p && dominates(q.m, p.m)));
    if (bad < 0) break;
    const role = picked[bad].role;
    const others = picked.filter((_, i) => i !== bad);
    const fits = (o: { k: Key; m: SpotMetrics }, minKm: number) => !picked.some((p) => p.k === o.k)
      && others.every((q) => w.env.distanceKm(q.k, o.k) >= minKm - 1e-9)
      && !others.some((q) => dominates(q.m, o.m) || dominates(o.m, q.m));
    const next = order[role].find((o) => fits(o, 2)) ?? opts.find((o) => fits(o, 2)) ?? opts.find((o) => fits(o, 1));
    if (!next) {
      picked.splice(bad, 1); // better two honest options than a decoy
      break;
    }
    picked[bad] = { ...next, role };
  }
  return picked.map((p) => ({ kind: 'land', spot: p.k, role: p.role }));
}

/** Ground label for a card: how steep it is to the neighbouring spots (REAL heights). */
export function groundLabel(w: World, k: Key): 'flat' | 'rough' | 'steep' {
  const s = w.summary(k);
  if (!s) return 'rough';
  let worst = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = w.summary(`${s.i + di},${s.j + dj}`);
    if (!n) continue;
    const km = Math.hypot(n.dx_km - s.dx_km, n.dy_km - s.dy_km);
    worst = Math.max(worst, (Math.atan2(Math.abs(n.ground_m - s.ground_m), km * 1000) * 180) / Math.PI);
  }
  return worst < 5 ? 'flat' : worst < 12 ? 'rough' : 'steep';
}

/** Hours in [from, to) with any of the Sun's disk above this spot's horizon (REAL). */
export function sunHoursAhead(w: World, k: Key, from: number, to: number): number {
  const f = w.series(k).fraction;
  let n = 0;
  for (let h = Math.max(0, from); h < Math.min(f.length, to); h++) if (f[h] > 0) n++;
  return n;
}

/**
 * Up to three craters a rover can reach from the base: the darkest floor, the
 * closest sunlit floor (nearer if one is), and a second sunlit floor whose Sun
 * over the rest of the run differs most from the first. Rovers cannot dig
 * while the Sun is on a floor, so the player has to read each floor's future.
 */
export function craterCards(s: GameState, w: World, until = (s.landedHour ?? s.hour) + RUN_DEADLINE_H): Card[] {
  if (!s.base) return [];
  const base = s.base;
  const reach = reachableDark(w.env, base, w.craters);
  const km = (k: Key) => w.env.route(base, k)!.km;
  const ahead = new Map(reach.map((k) => [k, sunHoursAhead(w, k, s.hour, until)]));
  const darkest = [...reach].sort((a, b) => w.floor(a) - w.floor(b) || km(a) - km(b));
  const closest = [...reach].sort((a, b) => km(a) - km(b));
  const lit = closest.filter((k) => w.tier(k) === 'sunlit');
  const picked: Key[] = [];
  const add = (k: Key | undefined) => { if (k && !picked.includes(k)) picked.push(k); };
  add(darkest[0]);
  add(lit.find((k) => !picked.includes(k) && picked[0] && km(k) < km(picked[0])) ?? lit.find((k) => !picked.includes(k)));
  const first = picked[1];
  if (first) {
    const other = lit.filter((k) => !picked.includes(k))
      .sort((a, b) => Math.abs(ahead.get(b)! - ahead.get(first)!) - Math.abs(ahead.get(a)! - ahead.get(first)!) || km(a) - km(b))[0];
    if (other && ahead.get(other) !== ahead.get(first)) add(other);
  }
  add(closest.find((k) => !picked.includes(k)));
  for (const k of darkest) if (picked.length < 3) add(k);
  return picked.slice(0, 3).map((target) => ({ kind: 'crater', target }));
}

/** Where a new solar tower could go: the three spots within cable reach that are sunny most while the base is dark. */
export function towerCards(s: GameState, w: World, until = Infinity): Card[] {
  if (!s.base) return [];
  return w.keys
    .filter((k) => !w.env.isDark(k) && !w.env.isCrater(k) && !s.towers.includes(k) && w.env.distanceKm(s.base!, k) <= CABLE_REACH_KM + 1e-9)
    .map((k) => ({ k, n: towerGainHours(s, w, k, until) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map(({ k }) => ({ kind: 'tower', spot: k }));
}

/** Hours from now (until `until`) that a tower at `spot` is sunny while the base is dark (REAL). */
export function towerGainHours(s: GameState, w: World, spot: Key, until = Infinity): number {
  if (!s.base) return 0;
  const a = w.series(spot).lit;
  const b = w.series(s.base).lit;
  let n = 0;
  const end = Math.min(a.length, until);
  for (let h = s.hour; h < end; h++) if (a[h] && !b[h]) n++;
  return n;
}

/** Window containing hour h at the base. */
export function currentWindow(w: World, base: Key, h: number): { win: SkyWindow; index: number } {
  const ws = w.windows(base);
  const index = windowIndexAt(ws, h);
  return { win: ws[index], index };
}

/** Round-trip facts for a crater (distance, hours, battery share). */
export function tripFacts(w: World, base: Key, target: Key, kind: 'haul' | 'prospect', speed?: number) {
  const route = w.env.route(base, target);
  const need = tripNeedKWh(w.env, base, target, kind, speed);
  return {
    km: route?.km ?? 0,
    hours: route ? tripHours(route.km, kind, speed) : 0,
    batteryPct: need === null ? 0 : Math.round((100 * need) / ROVER_BATTERY_KWH),
  };
}

/**
 * Can a mission start at a site? There must be a landing spot with an icy
 * crater in rover range. Needs only sites.json (for the site picker), so it
 * uses the index's sunlit numbers for the tiers.
 */
export function siteHasMission(summaries: GridSummary[]): boolean {
  const craters = craterSpots(summaries).map(keyOf);
  if (craters.length === 0) return false;
  const t = buildTerrain(summaries);
  const env = { route: t.route } as unknown as Env;
  return summaries.some((p) => !craters.includes(keyOf(p)) && p.sunlit_pct > 0 && reachableDark(env, keyOf(p), craters).length > 0);
}
