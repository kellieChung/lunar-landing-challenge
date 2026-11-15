import { describe, expect, it } from 'vitest';
import raw from '../../public/data/malapert-massif.json?raw';
import type { GridSummary, SiteData } from '../data/types';
import { BASE_MAST_M, describeEffect, mastHeights, mastRows, mastSummaries } from './MastControl';

const site = JSON.parse(raw) as SiteData;

describe('mast control data', () => {
  it('offers 3, 5, 10, 20 and 30 m, never lower than 3 m', () => {
    expect(mastHeights(site)).toEqual([3, 5, 10, 20, 30]);
    expect(mastHeights(site)[0]).toBe(BASE_MAST_M);
  });

  it('has year numbers for every height at any spot, not just the center', () => {
    for (const [i, j] of [[0, 0], [1, 0], [-5, 5]]) expect(mastRows(site, i, j).map((r) => r.m)).toEqual([3, 5, 10, 20, 30]);
  });

  it('3 m is the spot\'s own year numbers', () => {
    const pre = site.precomputed as { points: { i: number; j: number; year: { sunlit_pct: number } }[] };
    const want = pre.points.find((p) => p.i === 1 && p.j === 0)!.year.sunlit_pct;
    expect(mastRows(site, 1, 0)[0].year.sunlit_pct).toBe(want);
  });

  it('describes the change against 3 m (Malapert center, 10 m)', () => {
    const rows = mastRows(site, 0, 0);
    const text = describeEffect(rows[2], rows[0]);
    expect(text).toMatch(/^Sunlit 46\.4% \(\+19\.4\)/);
    expect(text).toMatch(/longest night 28\.1 d \(was 117\.0 d\)$/);
    expect(describeEffect(rows[0], rows[0])).not.toMatch(/\(|was/);
  });

  it('recolors the spot map from the chosen height, keeping positions', () => {
    const base: GridSummary[] = [{ i: 1, j: 0, dx_km: 1, dy_km: 0, lat: -86, lon: 0, ground_m: 5000,
      sunlit_pct: 1, earth_pct: 1, both_pct: 1, longest_dark_h: 1, longest_blackout_h: 1 }];
    const at10 = mastSummaries(site, base, 10)[0];
    expect(at10.ground_m).toBe(5000);
    expect(at10.sunlit_pct).toBe(mastRows(site, 1, 0)[2].year.sunlit_pct);
    expect(mastSummaries(site, base, 3)).toBe(base);
  });

  it('is empty for files without raised masts', () => {
    expect(mastHeights({ ...site, mast: undefined })).toEqual([]);
  });
});
