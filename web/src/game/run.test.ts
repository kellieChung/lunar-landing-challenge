// The run and its scoring (game.MD v3 §3, §8), on one shipped site.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GridSummary, SiteData, SiteIndexEntry } from '../data/types';
import { RUN_DEADLINE_H } from './constants';
import { buildWorld } from './env';
import { due, newRun, projectLandOptions, record, type Projection, type Run } from './run';
import { choicePoints, launched, nearMiss, ranks, skySense } from './score';
import { land } from './sim';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url), 'utf8')) as T;
const site = read<{ sites: SiteIndexEntry[] }>('sites.json').sites.find((s) => s.id === 'haworth')!;
const world = buildWorld(read<SiteData>('haworth.json'), site.grid as GridSummary[]);
const p = (days: number | null, fill = 1): Projection => ({ key: 'x', days, fill, sleep: 0 });

describe('run', () => {
  it('the same seed gives the same run; the start fits the deadline', () => {
    const a = newRun(world, 'seed-a');
    const b = newRun(world, 'seed-a');
    expect(b.startHour).toBe(a.startHour);
    expect(b.landOptions).toEqual(a.landOptions);
    expect(a.landOptions).toHaveLength(3);
    expect(a.startHour + RUN_DEADLINE_H).toBeLessThan(world.hours);
  });

  it('every run can be won: some landing option launches in the projection', () => {
    for (const seed of ['s1', 's2', 's3']) {
      const run = newRun(world, seed);
      expect(projectLandOptions(run, world).some((x) => x.days !== null), seed).toBe(true);
    }
  });

  it('after landing the crater choice comes first', () => {
    const run = newRun(world, 'seed-b');
    expect(due(run, world)).toBeNull(); // not landed: the screen asks for a spot
    land(run.game, world.env, run.landOptions[0], world.craters);
    expect(due(run, world)).toBe('crater');
  });
});

describe('score', () => {
  it('ranks by launch day; near outcomes tie; misses rank last by fill', () => {
    expect(ranks([p(30), p(31), p(40)])).toEqual([0, 0, 2]);
    expect(ranks([p(null, 0.9), p(null, 0.2), p(60)])).toEqual([1, 2, 0]);
  });

  it('a run is won by launching; Sky Sense averages the picks', () => {
    const run = newRun(world, 'seed-c') as Run;
    land(run.game, world.env, run.landOptions[0], world.craters);
    expect(launched(run)).toBe(false);
    run.game.launchedHour = run.game.hour + 500;
    expect(launched(run)).toBe(true);
    record(run, 'land', [p(30), p(50), p(70)], 2); // 20 points
    record(run, 'crater', [p(30), p(50)], 0); // 100 points
    record(run, 'tower', [p(30), p(50)], 0); // 100 points
    expect(skySense(run)).toBe(73);
    expect(choicePoints(run.choices[0])).toBe(20);
  });

  it('the near-miss line names the biggest gap with real numbers', () => {
    const run = newRun(world, 'seed-d');
    land(run.game, world.env, run.landOptions[0], world.craters);
    record(run, 'land', run.landOptions.map((k, i) => ({ key: k, days: i === 0 ? 70 : 40, fill: 1, sleep: 0 })), 0);
    const line = nearMiss(run, world);
    expect(line).toMatch(/30 days sooner/);
    expect(line).toMatch(/\d/);
  });
});
