// Python <-> TypeScript parity: the same fixture python/tests/test_metrics.py
// checks (written by python/scripts/make_metrics_fixture.py), plus the
// full-year metrics shipped in the site file.
// Loaded as raw text (not JSON imports) so tsc never types the big files.

import { describe, expect, it } from 'vitest';
import fixtureRaw from '../../../python/tests/fixtures/metrics_parity.json?raw';
import siteRaw from '../../public/data/nobile-rim-2.json?raw';
import type { SiteData } from '../data/types';
import { earthVisibleAt, nextChange, sunLitAt } from './events';
import { fluxWm2, siteSeries, windowMetrics, type SunSeries, type WindowMetrics } from './metrics';
import type { VectorSeries } from './time';

interface Case {
  name: string;
  step_hours: number;
  mask: number[];
  sun: SunSeries;
  earth: VectorSeries;
  windows: [number, number][];
  events: [number, 'sun' | 'earth', boolean][];
  expected: {
    fraction: number[];
    earth_margin: number[];
    windows: WindowMetrics[];
    events: (number | null)[];
  };
}

const cases = (JSON.parse(fixtureRaw) as { cases: Case[] }).cases;

function expectMetrics(got: WindowMetrics, want: WindowMetrics, tol: number): void {
  expect(got.samples).toBe(want.samples);
  expect(got.longest_dark_h).toBe(want.longest_dark_h);
  expect(got.longest_blackout_h).toBe(want.longest_blackout_h);
  for (const k of ['sunlit_pct', 'mean_sunlit_fraction', 'earth_pct', 'both_pct'] as const) {
    expect(Math.abs(got[k] - want[k]), k).toBeLessThanOrEqual(tol);
  }
  for (const k of ['tracking', 'vertical', 'horizontal'] as const) {
    expect(Math.abs(got.mean_flux_w_m2[k] - want.mean_flux_w_m2[k]), k).toBeLessThanOrEqual(tol * 1000);
  }
}

describe.each(cases)('parity: $name', (c) => {
  const s = siteSeries(c.sun, c.earth, c.mask);

  it('sunlit fraction and Earth margin per sample', () => {
    c.expected.fraction.forEach((f, i) => expect(Math.abs(s.fraction[i] - f)).toBeLessThanOrEqual(1e-12));
    c.expected.earth_margin.forEach((m, i) => expect(Math.abs(s.earthMargin[i] - m)).toBeLessThanOrEqual(1e-9));
  });

  it('window metrics', () => {
    c.windows.forEach(([a, n], i) => expectMetrics(windowMetrics(s, a, n, c.step_hours), c.expected.windows[i], 1e-9));
  });

  it('next sunrise / sunset / Earthrise / Earthset', () => {
    const lit = (t: number) => sunLitAt(c.sun, c.mask, t);
    const vis = (t: number) => earthVisibleAt(c.earth, c.mask, t);
    c.events.forEach(([t, body, to], i) => {
      const got = body === 'sun' ? nextChange(lit, s.lit, t, to) : nextChange(vis, s.earth, t, to);
      const want = c.expected.events[i];
      if (want === null) expect(got).toBeNull();
      else expect(Math.abs((got ?? NaN) - want)).toBeLessThanOrEqual(1e-6);
    });
  });
});

describe('shipped site file', () => {
  const site = JSON.parse(siteRaw) as SiteData & { precomputed: { center: { year: WindowMetrics } } };
  it('full-year metrics recomputed in the browser match Python', () => {
    const center = site.grid.points.find((p) => p.dx_km === 0 && p.dy_km === 0)!;
    const s = siteSeries(site.sun, site.earth, center.mask_deg);
    // The file rounds to 6 decimals.
    expectMetrics(windowMetrics(s, 0, s.count, site.time.step_hours), site.precomputed.center.year, 1e-6);
  });
});

describe('fluxWm2', () => {
  it('applies the panel factors', () => {
    const f = fluxWm2(1, 1, 30);
    expect(f.tracking).toBeCloseTo(1361, 9);
    expect(f.vertical).toBeCloseTo(1361 * Math.cos(Math.PI / 6), 9);
    expect(f.horizontal).toBeCloseTo(1361 * 0.5, 9);
    expect(fluxWm2(1, 1, -1).horizontal).toBe(0);
  });
});
