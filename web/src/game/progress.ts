// Progress between runs (game.MD v3 §8): which sites launched (best run kept),
// unlocks and Sky Rank. Stored in this browser only; nothing about the player.

import PAR from './par.json';
import type { Verdict } from './score';

const KEY = 'moonbase:v2:progress';

export interface SiteBest {
  done: boolean; // launched from here at least once
  stars?: number; // old saves (before stars were dropped): any star meant a launch
  skySense: number | null;
  days: number | null;
}

export interface Progress {
  v: 1;
  best: Record<string, SiteBest>;
  runs: number;
}

/** Sites with an ice run, easiest first (autopilot par; see par.test.ts). */
export const SITE_ORDER: string[] = (PAR as { order: string[] }).order;

/** Does this site host ice runs (some start can launch in time)? */
export const hostsRuns = (siteId: string) => SITE_ORDER.includes(siteId);
export const START_OPEN = 3;

export function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Progress) : null;
    if (p && p.v === 1 && p.best) return p;
  } catch {
    // storage blocked or damaged: start fresh
  }
  return { v: 1, best: {}, runs: 0 };
}

export function saveProgress(p: Progress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // not remembered; the game still works
  }
}

/** Keep the best result for a site. Returns true if it improved. */
const isDone = (b: SiteBest | undefined) => !!b && (b.done ?? (b.stars ?? 0) > 0);

/** Keep the best result for a site (a launch beats none; then the earlier launch). Returns true if it improved. */
export function recordResult(p: Progress, siteId: string, v: Verdict): boolean {
  p.runs++;
  const old = p.best[siteId];
  const better = !old || (v.launched && !isDone(old)) || (v.launched && (v.days ?? Infinity) < (old.days ?? Infinity));
  if (better) p.best[siteId] = { done: v.launched || isDone(old), skySense: v.skySense, days: v.days };
  return better;
}

export function siteDone(p: Progress, siteId: string): boolean {
  return isDone(p.best[siteId]);
}

/** Sites the player has launched from. */
export function sitesDone(p: Progress): number {
  return SITE_ORDER.filter((id) => siteDone(p, id)).length;
}

/** Each completed site opens the next one. */
export function unlockedCount(p: Progress): number {
  return Math.min(SITE_ORDER.length, START_OPEN + sitesDone(p));
}

export function isUnlocked(p: Progress, siteId: string): boolean {
  const i = SITE_ORDER.indexOf(siteId);
  return i >= 0 && i < unlockedCount(p);
}

/** Sites still to complete before this one opens (0 if open). */
export function sitesToUnlock(p: Progress, siteId: string): number {
  const i = SITE_ORDER.indexOf(siteId);
  if (i < 0 || i < unlockedCount(p)) return 0;
  return i - unlockedCount(p) + 1;
}

export const RANKS = [
  { min: 0, name: 'Cadet' },
  { min: 2, name: 'Navigator' },
  { min: 5, name: 'Pathfinder' },
  { min: 8, name: 'Pole Pilot' },
];

/** Rank from the number of sites completed. */
export function rankOf(done: number): string {
  return [...RANKS].reverse().find((r) => done >= r.min)!.name;
}
