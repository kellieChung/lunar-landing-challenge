// Scoring (game.MD §5, §8). Sky Sense judges each look-and-compare choice by
// how the options actually turned out in the projection, not by a formula.

import { fill } from './autopilot';
import { spotMetrics } from './cards';
import { RUN_DEADLINE_H, SKY_SENSE_POINTS } from './constants';
import type { World } from './env';
import { fuelReady } from './sim';
import type { ChoiceRecord, Projection, Run } from './run';

const DEADLINE_DAYS = RUN_DEADLINE_H / 24;

/** Sort value of a projection: launch day, or past the deadline by how empty the tank was. */
export function outcomeValue(p: Projection): number {
  return p.days ?? DEADLINE_DAYS + (1 - p.fill) * DEADLINE_DAYS;
}

/** Outcomes this close (days) count as a tie: the projection is an estimate, not a stopwatch. */
export const TIE_DAYS = 2;

/** 0-based rank of each option; outcomes within TIE_DAYS of a better one share its rank. */
export function ranks(options: Projection[]): number[] {
  const v = options.map(outcomeValue);
  return v.map((x) => v.filter((y) => y < x - TIE_DAYS).length);
}

export function choicePoints(c: ChoiceRecord): number {
  if (c.options.length < 2) return SKY_SENSE_POINTS[0];
  return SKY_SENSE_POINTS[Math.min(ranks(c.options)[c.picked], SKY_SENSE_POINTS.length - 1)];
}

/** Average Sky Sense of the run's choices (null before any choice). */
export function skySense(run: Run): number | null {
  const cs = run.choices.filter((c) => c.options.length > 1);
  if (cs.length === 0) return null;
  return Math.round(cs.reduce((a, c) => a + choicePoints(c), 0) / cs.length);
}

export function launched(run: Run): boolean {
  return run.game.launchedHour !== null;
}

const pct = (v: number) => `${Math.round(v)}%`;
const share = (f: number) => (f === 0 ? 'never' : f < 0.01 ? 'under 1% of the time' : `${Math.round(f * 100)}% of the time`);
const daysText = (d: number) => `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}`;

export const ROLE_NAME = { sun: 'sunny', earth: 'Earth-view', balanced: 'near-ice' } as const;

/** The single biggest thing that cost the run, said with REAL numbers (always one line). */
export function nearMiss(run: Run, w: World): string {
  let worst: { c: ChoiceRecord; gap: number; best: number } | null = null;
  for (const c of run.choices) {
    if (c.options.length < 2) continue;
    const v = c.options.map(outcomeValue);
    const best = v.indexOf(Math.min(...v));
    const gap = v[c.picked] - v[best];
    if (gap > TIE_DAYS && (!worst || gap > worst.gap)) worst = { c, gap, best };
  }
  if (!worst) {
    if (launched(run)) return 'Every pick was the best of what was offered. Faster still needs more rovers, and more rovers need more power.';
    if (fuelReady(run.game)) return 'The tanks were full.';
    return `Your picks matched the best projections, but your tank was only ${pct(100 * fill(run.game))} full at the deadline. This start date is a hard one.`;
  }
  const { c, gap, best } = worst;
  const p = c.options[c.picked].key;
  const b = c.options[best].key;
  const sooner = c.options[best].days !== null
    ? `It was projected to launch ${daysText(gap)} sooner.`
    : 'It got further before the deadline.';
  if (c.kind === 'land') {
    const pm = spotMetrics(w, p);
    const bm = spotMetrics(w, b);
    const role = ROLE_NAME[run.landRoles[run.landOptions.indexOf(b)] ?? 'balanced'];
    const diffs = [
      { d: (pm.night - bm.night) / Math.max(24, pm.night), t: `Your spot's longest night is ${Math.round(pm.night)} h; the ${role} spot's is ${Math.round(bm.night)} h.` },
      { d: (bm.sun - pm.sun) / 100, t: `Your spot is sunlit ${pct(pm.sun)} of the year; the ${role} spot ${pct(bm.sun)}.` },
      { d: (bm.earth - pm.earth) / 100, t: `Your spot sees Earth ${pct(pm.earth)} of the year; the ${role} spot ${pct(bm.earth)}, so its rovers drive more.` },
      { d: (pm.iceKm - bm.iceKm) / Math.max(1, pm.iceKm), t: `Your spot is ${pm.iceKm.toFixed(1)} km from ice; the ${role} spot ${bm.iceKm.toFixed(1)} km, so each rover trip is shorter.` },
    ].sort((x, y) => y.d - x.d);
    return `${diffs[0].d > 0 ? diffs[0].t : `The ${role} spot suited this start date better.`} ${sooner}`;
  }
  if (c.kind === 'crater') {
    const fp = w.floor(p);
    const fb = w.floor(b);
    const kp = w.env.route(run.game.base!, p)?.km ?? 0;
    const kb = w.env.route(run.game.base!, b)?.km ?? 0;
    const why = fb < fp
      ? `Your crater's floor sees the Sun ${share(fp)}; the other floor ${share(fb)}, so more ice survives there.`
      : `The other crater is ${(kp - kb).toFixed(1)} km closer, so each trip is shorter.`;
    return `${why} ${sooner}`;
  }
  return `The other tower spot is lit during more of your base's dark hours. ${sooner}`;
}

export interface Verdict {
  launched: boolean;
  skySense: number | null;
  sleepHours: number;
  days: number | null;
  nearMiss: string;
}

export function verdict(run: Run, w: World): Verdict {
  const s = run.game;
  return {
    launched: launched(run),
    skySense: skySense(run),
    sleepHours: s.sleepHours,
    days: s.launchedHour === null || s.landedHour === null ? null : (s.launchedHour - s.landedHour) / 24,
    nearMiss: nearMiss(run, w),
  };
}
