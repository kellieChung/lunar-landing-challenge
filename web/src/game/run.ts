// One run (game.MD §3): a site, a seeded start hour, the options offered at
// each look-and-compare, the choices made and how each option would have
// turned out. Pure data and functions; the screen (start.ts) drives it.

import { projectFrom, type Strategy } from './autopilot';
import { craterCards, landingCards, towerCards, type LandRole } from './cards';
import { BATTERY_KWH, PREPARE_LEAD_H, PREPARE_MIN_NIGHT_H, RUN_DEADLINE_H } from './constants';
import type { World } from './env';
import { BUILD_ITEMS, buildCost, chooseCrater, deliver, fuelReady, land, type BuildItem } from './sim';
import { newGame, type GameState, type Key } from './state';
import { pickStart, rng } from './seed';

export type ChoiceKind = 'land' | 'crater' | 'tower';

/** How one option of a choice turns out when the autopilot plays it (ESTIMATE). */
export interface Projection {
  key: Key;
  days: number | null; // landing to launch, null = missed the deadline
  fill: number; // fuel tank share filled at the end (0..1)
  sleep: number; // hours the base slept
}

export interface ChoiceRecord {
  kind: ChoiceKind;
  hour: number;
  options: Projection[];
  picked: number;
}

export interface Mods {
  trueScale?: boolean; // no vertical stretch in 3D
  noTimeline?: boolean; // hide the year timeline
  smallBattery?: boolean; // half the base battery
}

export interface Run {
  v: 2;
  seed: string;
  daily: boolean;
  siteId: string;
  startHour: number;
  mods: Mods;
  game: GameState;
  landOptions: Key[];
  landRoles: LandRole[];
  choices: ChoiceRecord[];
  buildSeen: string[]; // affordable builds already offered (so each is offered once)
  nightsSeen: number[]; // start hours of nights already announced
  blocking: string[]; // blocking tips already shown
  endedHour: number | null; // set when the run is over (launch or deadline)
}

/** The strategy every projection uses, so options are compared like for like. */
export const PROJECTION_STRATEGY: Strategy = 'mixed';

/**
 * A new run. The start hour and landing spots come from the seed; a draw where
 * no landing option can launch in time (by projection) is redrawn, so every
 * run can be won.
 */
export function newRun(w: World, seed: string, mods: Mods = {}, daily = false): Run {
  const rand = rng(`${seed}:${w.siteId}`);
  let run: Run | null = null;
  for (let tries = 0; tries < 12; tries++) {
    const startHour = pickStart(w, rand, RUN_DEADLINE_H);
    const cards = landingCards(w, rand);
    const game = newGame(w.siteId, startHour);
    if (mods.smallBattery) game.batteryKWh = game.batteryCapKWh = BATTERY_KWH / 2;
    run = {
      v: 2, seed, daily, siteId: w.siteId, startHour, mods, game,
      landOptions: cards.map((c) => (c as { spot: Key }).spot),
      landRoles: cards.map((c) => (c as { role: LandRole }).role),
      choices: [], buildSeen: [], nightsSeen: [], blocking: [], endedHour: null,
    };
    if (run.landOptions.length === 0 || projectLandOptions(run, w).some((p) => p.days !== null)) break;
  }
  return run!;
}

/** The hour by which the rocket must launch. */
export function deadlineHour(run: Run): number {
  return (run.game.landedHour ?? run.startHour) + RUN_DEADLINE_H;
}

/** Day of the run (1 = landing day). */
export function runDay(run: Run): number {
  return Math.floor((run.game.hour - (run.game.landedHour ?? run.startHour)) / 24) + 1;
}

export const RUN_DAYS = Math.round(RUN_DEADLINE_H / 24);

const proj = (key: Key, r: { days: number | null; fill: number; sleepHours: number }): Projection => ({ key, days: r.days, fill: r.fill, sleep: r.sleepHours });

/** Project every landing option from the run's start hour. */
export function projectLandOptions(run: Run, w: World): Projection[] {
  const s = newGame(w.siteId, run.startHour);
  s.batteryKWh = s.batteryCapKWh = run.game.batteryCapKWh; // same battery as this run (Small battery modifier)
  return run.landOptions.map((k) => proj(k, projectFrom(w, s, run.startHour + RUN_DEADLINE_H, (c) => land(c, w.env, k, w.craters).ok, PROJECTION_STRATEGY)));
}

/** Project each crater option from the current state. */
export function projectCraterOptions(run: Run, w: World, keys: Key[]): Projection[] {
  return keys.map((k) => proj(k, projectFrom(w, run.game, deadlineHour(run), (c) => chooseCrater(c, w.env, k).ok, PROJECTION_STRATEGY)));
}

/** Project each tower spot from the current state (the tower delivery is waiting). */
export function projectTowerOptions(run: Run, w: World, keys: Key[]): Projection[] {
  return keys.map((k) => proj(k, projectFrom(w, run.game, deadlineHour(run), (c) => deliver(c, w.env, 'tower', k).ok, PROJECTION_STRATEGY)));
}

export function record(run: Run, kind: ChoiceKind, options: Projection[], picked: number): void {
  run.choices.push({ kind, hour: run.game.hour, options, picked });
}

export function craterOptions(run: Run, w: World): Key[] {
  return craterCards(run.game, w).map((c) => (c as { target: Key }).target);
}

export function towerOptions(run: Run, w: World): Key[] {
  return towerCards(run.game, w, deadlineHour(run)).map((c) => (c as { spot: Key }).spot);
}

/** Builds that the dirt pays for right now. */
export function affordable(run: Run, w: World): BuildItem[] {
  const s = run.game;
  return BUILD_ITEMS.filter((i) => {
    const c = buildCost(s, w.env, i);
    return c !== null && s.tailingsKg >= c;
  });
}

/** Identity of a build offer: the pad number, or the shelter. */
const offerId = (run: Run, item: BuildItem) => (item === 'pad' ? `pad${run.game.pads ?? 0}` : item);

/** Builds newly affordable since the last offer (the clock pauses for these once). */
export function newBuilds(run: Run, w: World): BuildItem[] {
  return affordable(run, w).filter((i) => !run.buildSeen.includes(offerId(run, i)));
}

export function markBuildsSeen(run: Run, w: World): void {
  for (const i of affordable(run, w)) {
    const id = offerId(run, i);
    if (!run.buildSeen.includes(id)) run.buildSeen.push(id);
  }
}

export interface Night {
  start: number;
  end: number;
}

/** Dark stretches at the base (Sun fully down) of at least PREPARE_MIN_NIGHT_H, between two hours. */
export function nightsAt(w: World, base: Key, from: number, to: number): Night[] {
  const lit = w.series(base).lit;
  const out: Night[] = [];
  let h = Math.max(0, from);
  const end = Math.min(lit.length, to);
  while (h < end) {
    if (lit[h]) { h++; continue; }
    const start = h;
    while (h < lit.length && !lit[h]) h++;
    if (h - start >= PREPARE_MIN_NIGHT_H) out.push({ start, end: h });
  }
  return out;
}

/** A long night is coming within the lead time and hasn't been announced. */
export function nightAhead(run: Run, w: World): Night | null {
  const s = run.game;
  if (!s.base) return null;
  const next = nightsAt(w, s.base, s.hour, s.hour + PREPARE_LEAD_H + 1).find((n) => n.start > s.hour);
  return next && !run.nightsSeen.includes(next.start) ? next : null;
}

export type Due = 'crater' | 'delivery' | 'build' | 'prepare' | 'launch' | 'deadline' | null;

/** The next thing that stops the clock, in priority order. */
export function due(run: Run, w: World): Due {
  const s = run.game;
  if (!s.base || run.endedHour !== null) return null;
  if (fuelReady(s)) return 'launch';
  if (s.hour >= deadlineHour(run) || s.hour >= w.hours - 1) return 'deadline';
  if (!s.crater) return 'crater';
  if ((s.deliveries ?? 0) > 0) return 'delivery';
  if (newBuilds(run, w).length > 0) return 'build';
  if (nightAhead(run, w)) return 'prepare';
  return null;
}

