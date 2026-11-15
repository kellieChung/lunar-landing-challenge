// Site difficulty from the real data: for the first few start hours of each
// site, the best projected outcome among the offered landing spots. Sites are
// unlocked easiest first (progress.ts reads par.json).
//
// Regenerate after a rule or data change:  UPDATE_PAR=1 npx vitest run src/game/par.test.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GridSummary, SiteData, SiteIndexEntry } from '../data/types';
import { siteHasMission } from './cards';
import { STRATEGIES, projectFrom } from './autopilot';
import { RUN_DEADLINE_H } from './constants';
import { land } from './sim';
import { newGame } from './state';
import { buildWorld } from './env';
import { newRun, projectLandOptions } from './run';
import { outcomeValue } from './score';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url), 'utf8')) as T;
const index = read<{ sites: SiteIndexEntry[] }>('sites.json').sites;
const PAR_FILE = new URL('./par.json', import.meta.url);

/** Least average sleep (h) any build order manages, landing on its best spot. */
function parSleep(w: ReturnType<typeof buildWorld>, id: string): number {
  let best = Infinity;
  for (const st of STRATEGIES) {
    let sleep = 0;
    for (let n = 0; n < 3; n++) {
      const run = newRun(w, `balance:${n}`);
      const outs = run.landOptions.map((k) => projectFrom(w, newGame(id, run.startHour), run.startHour + RUN_DEADLINE_H, (c) => land(c, w.env, k, w.craters).ok, st));
      const r = outs.reduce((a, b) => ((b.days ?? 999) < (a.days ?? 999) ? b : a));
      sleep += r.sleepHours;
    }
    best = Math.min(best, sleep / 3);
  }
  return Math.round(best);
}

export function computePar(): { order: string[]; days: Record<string, number>; sleep: Record<string, number> } {
  const days: Record<string, number> = {};
  const sleep: Record<string, number> = {};
  for (const site of index) {
    if (!site.grid || !siteHasMission(site.grid as GridSummary[])) continue;
    const w = buildWorld(read<SiteData>(`${site.id}.json`), site.grid as GridSummary[]);
    if (w.craters.length === 0) continue;
    const vals: number[] = [];
    for (let n = 0; n < 4; n++) {
      const run = newRun(w, `par:${n}`);
      if (run.landOptions.length === 0) continue;
      vals.push(Math.min(...projectLandOptions(run, w).map(outcomeValue)));
    }
    // A site hosts runs only if some start can launch before the deadline.
    if (vals.some((v) => v <= RUN_DEADLINE_H / 24)) {
      days[site.id] = Math.round((10 * vals.reduce((a, b) => a + b, 0)) / vals.length) / 10;
      sleep[site.id] = parSleep(w, site.id);
    }
  }
  const order = Object.keys(days).sort((a, b) => days[a] - days[b]);
  return { order, days, sleep };
}

describe('site par', () => {
  it('par.json matches the data and rules (UPDATE_PAR=1 to regenerate)', () => {
    const par = computePar();
    if (process.env.UPDATE_PAR) writeFileSync(PAR_FILE, `${JSON.stringify(par, null, 2)}\n`);
    const saved = JSON.parse(readFileSync(PAR_FILE, 'utf8'));
    expect(saved).toEqual(par);
    // Malapert has no cold trap. Cabeus B Peak's floors all see a little Sun:
    // a run built only on sunlit floors, where timing the dig matters.
    expect(par.order).not.toContain('malapert-massif');
    expect(par.order).toContain('cabeus-b-peak');
    expect(par.order.length).toBe(8);
  }, 300_000);
});
