// Where ice might be, and how much. Two very different kinds of fact:
//  - REAL: which grid spots got no sunlight in all of 2027 (sites.json, from
//    the horizon-mask physics, 3 m mast). This is our own one-year test, not
//    the official multi-year "permanently shadowed region" maps.
//  - HYPOTHETICAL: how much ice a dark spot holds. Nobody has measured it at
//    these spots; each gets a fixed made-up value inside the LCROSS range.

import type { GridSummary } from '../data/types';
import { ICE_WT_PCT_MEAN, ICE_WT_PCT_SIGMA, LIT_MAX_SUNLIT } from './constants';
import { keyOf, type Key } from './state';

/**
 * Always-dark spots: no part of the Sun's disk showed in any hour of 2027
 * (mean sunlit fraction 0). Older index files without that number fall back
 * to "never half lit" (sunlit_pct 0); env.ts then checks every hour itself.
 * The site picker uses this too, so it promises exactly what the game finds.
 */
export function darkSpots(summaries: GridSummary[]): GridSummary[] {
  return summaries.filter((s) => (s.mean_sunlit_fraction ?? s.sunlit_pct) === 0);
}

/** Deterministic 0..1 number from a string (FNV-1a hash, then one mulberry32 step). */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  let t = (h + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * HYPOTHETICAL ice share (0..1 by mass) of a dark spot: the same value every
 * time for the same site and spot, spread evenly over the LCROSS range
 * (mean - sigma .. mean + sigma, i.e. 2.7% .. 8.5%).
 */
export function iceFraction(siteId: string, i: number, j: number): number {
  const lo = ICE_WT_PCT_MEAN - ICE_WT_PCT_SIGMA;
  const hi = ICE_WT_PCT_MEAN + ICE_WT_PCT_SIGMA;
  return (lo + (hi - lo) * hash01(`${siteId}:${i},${j}`)) / 100;
}

/** Ice share for every dark spot of a site, by spot key. */
export function iceMap(siteId: string, summaries: GridSummary[]): Map<Key, number> {
  return new Map(darkSpots(summaries).map((s) => [keyOf(s), iceFraction(siteId, s.i, s.j)]));
}

// ---- Cold-trap tiers (game.MD v3 §6) ---------------------------------------

export type IceTier = 'rich' | 'sunlit' | 'none';

/** REAL: mean share of the Sun's disk above the horizon at this floor over 2027 (0..1). */
export function floorSunlit(s: GridSummary): number {
  return s.mean_sunlit_fraction ?? s.sunlit_pct / 100;
}

/** Game rule: the ice tier of a floor from its mean sunlit share. */
export function iceTier(sunlit: number): IceTier {
  if (sunlit <= 0) return 'rich';
  return sunlit <= LIT_MAX_SUNLIT ? 'sunlit' : 'none';
}

/**
 * HYPOTHETICAL ice share of a floor: the cell's fixed roll inside the LCROSS
 * range, times the share that survives the Sun: all of it on a floor that never
 * sees the Sun, shrinking linearly to a quarter at the cut-off.
 */
export function tieredIce(siteId: string, i: number, j: number, sunlit: number): number {
  const tier = iceTier(sunlit);
  if (tier === 'none') return 0;
  return iceFraction(siteId, i, j) * (1 - 0.75 * (sunlit / LIT_MAX_SUNLIT));
}

/** Cells whose floor holds some ice by the tier rule (from sites.json numbers only). */
export function craterSpots(summaries: GridSummary[]): GridSummary[] {
  return summaries.filter((s) => iceTier(floorSunlit(s)) !== 'none');
}
