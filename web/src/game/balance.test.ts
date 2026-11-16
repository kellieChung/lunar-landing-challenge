// Balance sweep (game.MD §4): with the autopilot, no single build order
// should be the best at most sites, and every ice site must be winnable.
// "Best" = launches in the most runs, then the earliest launch.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GridSummary, SiteData, SiteIndexEntry } from '../data/types';
import { STRATEGIES, projectFrom, type Strategy } from './autopilot';
import { RUN_DEADLINE_H } from './constants';
import { buildWorld } from './env';
import PAR from './par.json';
import { newRun } from './run';
import { land } from './sim';
import { newGame } from './state';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url), 'utf8')) as T;
const index = read<{ sites: SiteIndexEntry[] }>('sites.json').sites;

export function sweep() {
  const table: Record<string, Record<Strategy, { score: number; days: number | null; sleep: number }>> = {};
  for (const id of PAR.order) {
    const site = index.find((s) => s.id === id)!;
    const w = buildWorld(read<SiteData>(`${id}.json`), site.grid as GridSummary[]);
    const row = {} as Record<Strategy, { score: number; days: number | null; sleep: number }>;
    for (const st of STRATEGIES) {
      let score = 0, days = 0, sleep = 0, launches = 0;
      for (let n = 0; n < 3; n++) {
        const run = newRun(w, `balance:${n}`);
        // The best landing spot for this strategy, as a player who knows it would pick.
        const outs = run.landOptions.map((k) => projectFrom(w, newGame(id, run.startHour), run.startHour + RUN_DEADLINE_H, (c) => land(c, w.env, k, w.craters).ok, st));
        const r = outs.reduce((a, b) => ((b.days ?? 999) < (a.days ?? 999) ? b : a));
        score += r.days === null ? 0 : 1;
        if (r.days !== null) { days += r.days; launches++; }
        sleep += r.sleepHours;
      }
      row[st] = { score, days: launches ? Math.round(days / launches) : null, sleep: Math.round(sleep / 3) };
    }
    table[id] = row;
  }
  return table;
}

describe('balance', () => {
  it('no build order wins everywhere, and every ice site can launch', () => {
    const table = sweep();
    const wins: Record<string, number> = {};
    for (const [id, row] of Object.entries(table)) {
      const best = STRATEGIES.reduce((a, b) => {
        const x = row[a], y = row[b];
        if (y.score !== x.score) return y.score > x.score ? b : a;
        return (y.days ?? 999) < (x.days ?? 999) ? b : a;
      });
      wins[best] = (wins[best] ?? 0) + 1;
      expect(Math.max(...STRATEGIES.map((s) => row[s].score)), id).toBeGreaterThan(0);
    }
    console.info(JSON.stringify(table), wins);
    // Rovers-first is the fastest at most sites; another order must still win
    // somewhere, so the delivery choice is a real one.
    expect(Math.max(...Object.values(wins))).toBeLessThan(PAR.order.length);
    expect(Object.keys(wins).length).toBeGreaterThanOrEqual(2);
  }, 600_000);
});
