// Python <-> TypeScript parity: the same fixture python/tests/test_metrics.py
// checks (written by python/scripts/make_metrics_fixture.py), plus the
// full-year metrics shipped in the site file.
// Loaded as raw text (not JSON imports) so tsc never types the big files.

import { describe, expect, it } from 'vitest';
import fixtureRaw from '../../../python/tests/fixtures/metrics_parity.json?raw';
import siteRaw from '../../public/data/nobile-rim-2.json?raw';
import haworthRaw from '../../public/data/haworth.json?raw';
import type { SiteData } from '../data/types';
import { earthVisibleAt, nextChange, sunLitAt } from './events';
import { pointVectors } from './grid';
import { fluxWm2, siteSeries, windowMetrics, type EarthSeries, type SunSeries, type WindowMetrics } from './metrics';
import { eclipseShare } from './visibility';

interface Case {
  name: string;
  step_hours: number;
  mask: number[];
  sun: SunSeries;
  earth: EarthSeries;
  windows: [number, number][];
  events: [number, 'sun' | 'earth', boolean][];
  tilt?: [number, number]; // off-center grid point: rotate the vectors first
  expected: {
    fraction: number[];
    eclipse: number[];
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
  const sun = c.tilt ? pointVectors(c.sun, c.tilt) : c.sun;
  const earth = c.tilt ? pointVectors(c.earth, c.tilt) : c.earth;
  const s = siteSeries(sun, earth, c.mask);

  it('sunlit fraction and Earth margin per sample', () => {
    c.expected.fraction.forEach((f, i) => expect(Math.abs(s.fraction[i] - f)).toBeLessThanOrEqual(1e-12));
    c.expected.earth_margin.forEach((m, i) => expect(Math.abs(s.earthMargin[i] - m)).toBeLessThanOrEqual(1e-9));
    c.expected.eclipse.forEach((x, i) => expect(Math.abs(s.eclipse[i] - x)).toBeLessThanOrEqual(1e-12));
  });

  it('window metrics', () => {
    c.windows.forEach(([a, n], i) => expectMetrics(windowMetrics(s, a, n, c.step_hours), c.expected.windows[i], 1e-9));
  });

  it('next sunrise / sunset / Earthrise / Earthset', () => {
    const lit = (t: number) => sunLitAt(sun, c.mask, t);
    const vis = (t: number) => earthVisibleAt(earth, c.mask, t);
    c.events.forEach(([t, body, to], i) => {
      const got = body === 'sun' ? nextChange(lit, s.lit, t, to) : nextChange(vis, s.earth, t, to);
      const want = c.expected.events[i];
      if (want === null) expect(got).toBeNull();
      else expect(Math.abs((got ?? NaN) - want)).toBeLessThanOrEqual(1e-6);
    });
  });
});

type Shipped = SiteData & {
  precomputed: { center: { year: WindowMetrics }; points: { i: number; j: number; year: WindowMetrics }[] };
};

describe.each([['nobile-rim-2', siteRaw], ['haworth', haworthRaw]])('shipped site file %s', (_, raw) => {
  const site = JSON.parse(raw) as Shipped;
  it('full-year metrics recomputed in the browser match Python (center)', () => {
    const center = site.grid.points.find((p) => p.dx_km === 0 && p.dy_km === 0)!;
    const s = siteSeries(site.sun, site.earth, center.mask_deg);
    // The file rounds to 6 decimals.
    expectMetrics(windowMetrics(s, 0, s.count, site.time.step_hours), site.precomputed.center.year, 1e-6);
  });
  it.each([[-5, -5], [5, 5], [3, -2], [-1, 4]])('match Python at grid point (%i, %i)', (i, j) => {
    const p = site.grid.points.find((q) => q.i === i && q.j === j)!;
    const want = site.precomputed.points.find((q) => q.i === i && q.j === j)!.year;
    const s = siteSeries(pointVectors(site.sun, p.up_tilt), pointVectors(site.earth, p.up_tilt), p.mask_deg);
    expectMetrics(windowMetrics(s, 0, s.count, site.time.step_hours), want, 1e-6);
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

describe('eclipseShare', () => {
  const RAD = Math.PI / 180;
  const at = (azDeg: number): [number, number, number] => [Math.sin(azDeg * RAD), Math.cos(azDeg * RAD), 0];
  const share = (sepDeg: number) => eclipseShare(...at(100), 1, ...at(100 + sepDeg), 384_400);
  it('is 1 with no overlap and 0 when Earth covers the Sun', () => {
    expect(share(5)).toBe(1);
    expect(share(0)).toBe(0);
    expect(share(0.6)).toBe(0);
  });
  it('is a little over half with Earth\'s edge through the Sun\'s center', () => {
    const b = Math.asin(6371 / 384_400) / RAD;
    expect(share(b)).toBeGreaterThan(0.5);
    expect(share(b)).toBeLessThan(0.6);
  });
  it('2027-08-17: Earth covers about 45% of the Sun (the parity fixture\'s eclipse case)', () => {
    const c = cases.find((x) => x.name.includes('5440'))!;
    expect(Math.min(...c.expected.eclipse)).toBeGreaterThan(0.5);
    expect(Math.min(...c.expected.eclipse)).toBeLessThan(0.6);
    expect(c.expected.eclipse.filter((x) => x < 1).length).toBeGreaterThanOrEqual(2);
  });
  it('scales the flux', () => {
    expect(fluxWm2(1, 1, 0, 0.55).tracking).toBeCloseTo(1361 * 0.55, 9);
  });
});
