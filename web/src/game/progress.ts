// Progress between runs (game.MD v3 §8): best stars per site, unlocks and Sky
// Rank. Stored in this browser only; nothing about the player.

import PAR from './par.json';
import type { Verdict } from './score';

const KEY = 'moonbase:v2:progress';

export interface SiteBest {
  stars: number;
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
export const STARS_PER_UNLOCK = 3;

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
export function recordResult(p: Progress, siteId: string, v: Verdict): boolean {
  p.runs++;
  const old = p.best[siteId];
  const better = !old || v.stars > old.stars || (v.stars === old.stars && (v.days ?? Infinity) < (old.days ?? Infinity));
  if (better) p.best[siteId] = { stars: v.stars, skySense: v.skySense, days: v.days };
  return better;
}

export function totalStars(p: Progress): number {
  return Object.values(p.best).reduce((a, b) => a + b.stars, 0);
}

export function unlockedCount(p: Progress): number {
  return Math.min(SITE_ORDER.length, START_OPEN + Math.floor(totalStars(p) / STARS_PER_UNLOCK));
}

export function isUnlocked(p: Progress, siteId: string): boolean {
  const i = SITE_ORDER.indexOf(siteId);
  return i >= 0 && i < unlockedCount(p);
}

/** Stars still needed to open a locked site (0 if open). */
export function starsToUnlock(p: Progress, siteId: string): number {
  const i = SITE_ORDER.indexOf(siteId);
  if (i < 0 || i < unlockedCount(p)) return 0;
  return (i - START_OPEN + 1) * STARS_PER_UNLOCK - totalStars(p);
}

export const RANKS = [
  { min: 0, name: 'Cadet' },
  { min: 6, name: 'Navigator' },
  { min: 12, name: 'Pathfinder' },
  { min: 18, name: 'Pole Pilot' },
];

export function rankOf(stars: number): string {
  return [...RANKS].reverse().find((r) => stars >= r.min)!.name;
}
