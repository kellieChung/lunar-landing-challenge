// What makes each run different: a seeded random source, the start hour (near
// a sunrise or sunset at the site, so the first hours have something
// happening), and the Daily Mission seed (same for everyone on a date, no
// server).

import type { World } from './env';
import { hash01 } from './deposits';

/** Deterministic random numbers in [0, 1) from a text seed (mulberry32). */
export function rng(seed: string): () => number {
  let a = Math.floor(hash01(seed) * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for an ordinary run. */
export function newSeed(): string {
  return `run:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** The Daily Mission seed for a date (local calendar day). */
export function dailySeed(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `daily:${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Hours at which a run may start: 12 h before the Sun rises or sets at the
 * site center (REAL), early enough that the whole deadline fits in the data.
 */
export function startHours(w: World, deadlineH: number, at = '0,0'): number[] {
  const lit = w.series(at).lit;
  const latest = w.hours - deadlineH - 2;
  const out: number[] = [];
  for (let h = 1; h < lit.length; h++) {
    if (lit[h] !== lit[h - 1] && h - 12 >= 0 && h - 12 <= latest) out.push(h - 12);
  }
  // A site where the center never changes (always lit): any hour works.
  if (out.length === 0) for (let h = 0; h <= latest; h += 24) out.push(h);
  return out;
}

export function pickStart(w: World, rand: () => number, deadlineH: number): number {
  const hs = startHours(w, deadlineH);
  return hs[Math.floor(rand() * hs.length)];
}
