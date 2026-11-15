// Raised-mast horizons (every grid point, one file per height): the browser
// recomputes the year numbers Python wrote into precomputed.mast.

import { describe, expect, it } from 'vitest';
import siteRaw from '../../public/data/malapert-massif.json?raw';
import m10Raw from '../../public/data/malapert-massif_mast10.json?raw';
import m30Raw from '../../public/data/malapert-massif_mast30.json?raw';
import type { MastFile, MastYear, SiteData } from '../data/types';
import { pointVectors } from './grid';
import { siteSeries, windowMetrics } from './metrics';

type Shipped = SiteData & { precomputed: { mast: { height_m: number; points: { i: number; j: number; year: MastYear }[] }[] } };
const site = JSON.parse(siteRaw) as Shipped;
const files = [JSON.parse(m10Raw), JSON.parse(m30Raw)] as MastFile[];

describe('raised mast at malapert-massif', () => {
  it('lists 3 to 30 m and a file for each raised height', () => {
    expect(site.mast!.heights_m).toEqual([3, 5, 10, 20, 30]);
    expect(site.mast!.files['10']).toBe('malapert-massif_mast10.json');
    expect(Math.min(...site.mast!.heights_m)).toBeGreaterThanOrEqual(3);
  });

  describe.each(files.map((f) => [f.height_m, f] as const))('%d m', (h, f) => {
    it('covers every grid point', () => expect(f.points.length).toBe(site.grid.points.length));
    it.each([[0, 0], [1, 0], [-5, -5], [4, 3]])('browser year numbers match Python at (%i, %i)', (i, j) => {
      const p = site.grid.points.find((q) => q.i === i && q.j === j)!;
      const raised = f.points.find((q) => q.i === i && q.j === j)!;
      const want = site.precomputed.mast.find((m) => m.height_m === h)!.points.find((q) => q.i === i && q.j === j)!.year;
      const s = siteSeries(pointVectors(site.sun, p.up_tilt), pointVectors(site.earth, p.up_tilt), raised.mask_deg);
      const got = windowMetrics(s, 0, s.count, site.time.step_hours);
      for (const k of ['sunlit_pct', 'earth_pct', 'both_pct', 'longest_dark_h', 'longest_blackout_h'] as const) {
        expect(Math.abs(got[k] - want[k]), k).toBeLessThanOrEqual(0.005 + 1e-9); // file rounds to 2 decimals
      }
    });
  });
});
