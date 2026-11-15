// A headless player. It replays a run on the real sky with the game rules and
// a fixed build strategy, so the game can say how each option of a choice
// would have turned out ("projected launch: day 27"). Projections are an
// ESTIMATE: the autopilot plays sensibly, not perfectly.

import { craterCards, towerCards, tripFacts } from './cards';
import type { World } from './env';
import { buildCost, buy, chooseCrater, deliver, fuelReady, land, launch, step, TARGET, type Delivery } from './sim';
import { newGame, type GameState, type Key } from './state';

export type Strategy = 'rovers' | 'towers' | 'mixed' | 'shelter' | 'battery';
export const STRATEGIES: Strategy[] = ['rovers', 'towers', 'mixed', 'shelter', 'battery'];

export interface AutoResult {
  launchHour: number | null;
  /** Days from landing to launch, or null if the deadline passed first. */
  days: number | null;
  sleepHours: number;
  /** Share of the capsule filled when the run ended (0..1). */
  fill: number;
  state: GameState;
}

/** Fuel share (0..1): the scarcer of hydrogen and oxygen. */
export function fill(s: GameState): number {
  return Math.min(1, s.h2Kg / TARGET.h2Kg, s.o2Kg / TARGET.o2Kg);
}

/** The crater the autopilot mines: most ice per hour of round trip, among those offered. */
export function autoCrater(s: GameState, w: World): Key | null {
  if (!s.base) return null;
  const opts = craterCards(s, w).map((c) => (c as { target: Key }).target);
  let best: Key | null = null;
  let score = -1;
  for (const k of opts) {
    const v = (w.ice.get(k) ?? 0) / Math.max(1, tripFacts(w, s.base, k, 'haul').hours);
    if (v > score) { score = v; best = k; }
  }
  return best;
}

/** What the n-th pad delivery (0-based) is under a strategy. */
export function deliveryFor(strategy: Strategy, n: number): Delivery {
  switch (strategy) {
    case 'rovers': case 'shelter': return 'rover';
    case 'towers': return n < 2 ? 'tower' : 'rover';
    case 'mixed': return (['rover', 'tower', 'rover', 'battery'] as Delivery[])[n % 4];
    case 'battery': return n % 2 === 0 ? 'battery' : 'rover';
  }
}

/** Spend dirt and take deliveries the way a strategy would. */
function shop(s: GameState, w: World, strategy: Strategy, deadlineHour: number): void {
  const wantShelter = !s.shelter && (strategy === 'shelter' || (strategy === 'mixed' && (s.pads ?? 0) >= 2));
  const item = wantShelter ? 'shelter' : 'pad';
  const cost = buildCost(s, w.env, item);
  if (cost !== null && s.tailingsKg >= cost) buy(s, w.env, item);
  while ((s.deliveries ?? 0) > 0) {
    const n = (s.pads ?? 1) - (s.deliveries ?? 0);
    let kind = deliveryFor(strategy, n);
    if (kind === 'tower') {
      const spot = (towerCards(s, w, deadlineHour)[0] as { spot: Key } | undefined)?.spot;
      if (spot && deliver(s, w.env, 'tower', spot).ok) continue;
      kind = 'rover';
    }
    deliver(s, w.env, kind);
  }
}

/**
 * Play `s` (already landed; modified in place) until launch or the deadline.
 * Picks a crater first if none is chosen.
 */
export function playOut(s: GameState, w: World, deadlineHour: number, strategy: Strategy = 'mixed'): AutoResult {
  if (!s.crater) {
    const c = autoCrater(s, w);
    if (c) chooseCrater(s, w.env, c);
  }
  const end = Math.min(deadlineHour, w.hours - 1);
  while (s.hour < end && s.launchedHour === null) {
    step(s, w.env);
    shop(s, w, strategy, deadlineHour);
    if (fuelReady(s)) launch(s);
  }
  const days = s.launchedHour === null || s.landedHour === null ? null : (s.launchedHour - s.landedHour) / 24;
  return { launchHour: s.launchedHour, days, sleepHours: s.sleepHours, fill: fill(s), state: s };
}

/** Land at `spot` at `startHour` and play the run out. */
export function projectLanding(w: World, startHour: number, spot: Key, deadlineH: number, strategy: Strategy = 'mixed'): AutoResult {
  const s = newGame(w.siteId, startHour);
  if (!land(s, w.env, spot, w.craters).ok) return { launchHour: null, days: null, sleepHours: 0, fill: 0, state: s };
  return playOut(s, w, startHour + deadlineH, strategy);
}

/** Copy the current run, apply one change (a choice), and play it out. */
export function projectFrom(w: World, s: GameState, deadlineHour: number, change: (c: GameState) => boolean, strategy: Strategy = 'mixed'): AutoResult {
  const c = structuredClone(s);
  if (!change(c)) return { launchHour: null, days: null, sleepHours: c.sleepHours, fill: fill(c), state: c };
  return playOut(c, w, deadlineHour, strategy);
}
