import { describe, expect, it } from 'vitest';
import { exaggerateEl } from './mapping';
import { GLOW_BELOW_DEG, maxMask, rimGlow, ringPositions, ringShade } from './rings';

const R = 1000;
const mask = Array.from({ length: 360 }, (_, i) => Math.sin((i * Math.PI) / 90) * 3);

function topAzEl(pos: Float32Array, c: number) {
  const [x, y, z] = pos.subarray(c * 6, c * 6 + 3);
  const d = Math.hypot(x, z);
  return { az: ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360, el: (Math.atan2(y, d) * 180) / Math.PI, d };
}

describe('ringPositions', () => {
  it('puts each top vertex exactly at the (shown) mask elevation', () => {
    for (const k of [1, 5]) {
      const pos = ringPositions(mask, k, R);
      for (const c of [0, 45, 90, 181, 359]) {
        const t = topAzEl(pos, c);
        expect(t.d).toBeCloseTo(R, 3);
        expect(t.az).toBeCloseTo(c, 3);
        expect(t.el).toBeCloseTo(exaggerateEl(mask[c], k), 4);
      }
    }
  });

  it('azimuth 0 is -z (north) and 90 is +x (east)', () => {
    const pos = ringPositions(new Array(360).fill(0), 1, R);
    expect(pos[2]).toBeCloseTo(-R, 3);
    expect(pos[90 * 6]).toBeCloseTo(R, 3);
  });

  it('closes the seam', () => {
    const pos = ringPositions(mask, 3, R);
    const last = pos.subarray(360 * 6, 360 * 6 + 6);
    Array.from(pos.subarray(0, 6)).forEach((v, i) => expect(last[i]).toBeCloseTo(v, 3));
  });

  it('clamps "no terrain" (-90) to the bottom edge, all values finite', () => {
    const pos = ringPositions(new Array(360).fill(-90), 10, R, -80);
    expect(pos.every(Number.isFinite)).toBe(true);
    expect(topAzEl(pos, 10).el).toBeCloseTo(-80, 3);
  });
});

describe('maxMask', () => {
  it('is the element-wise max', () => {
    expect(maxMask([1, 5, -90], [2, 0, -3])).toEqual([2, 5, -3]);
  });
});

describe('ringShade', () => {
  const night = { fill: 0.4, sunAz: 90, sunEl: -5, sunDay: 0, earthAz: 0, earthLight: 0 };
  it('is just the fill at night with no Earthshine', () => {
    for (const az of [0, 90, 200]) expect(ringShade(az, night)).toBeCloseTo(0.4, 12);
  });
  it('by day, ridges opposite the Sun are brighter than backlit ones toward it', () => {
    const day = { ...night, sunEl: 1, sunDay: 1 };
    expect(ringShade(270, day)).toBeGreaterThan(ringShade(90, day));
    expect(ringShade(90, day)).toBeGreaterThan(night.fill); // still some light
  });
  it('Earthshine lights the ridges opposite Earth', () => {
    const e = { ...night, earthAz: 0, earthLight: 1 };
    expect(ringShade(180, e)).toBeGreaterThan(ringShade(0, e));
  });
});

describe('rimGlow', () => {
  const flat2 = new Array(360).fill(2);
  const L = { fill: 0.4, sunAz: 100, sunEl: 1, sunDay: 0, earthAz: 0, earthLight: 0 };
  it('peaks at the Sun azimuth when the Sun is just below the ridge', () => {
    expect(rimGlow(100, flat2, L)).toBeCloseTo(1 - 1 / GLOW_BELOW_DEG, 9);
    expect(rimGlow(100, flat2, L)).toBeGreaterThan(rimGlow(110, flat2, L));
    expect(rimGlow(280, flat2, L)).toBeCloseTo(0, 6);
  });
  it('is off when the Sun is above the ridge or far below it', () => {
    expect(rimGlow(100, flat2, { ...L, sunEl: 2.5 })).toBe(0);
    expect(rimGlow(100, flat2, { ...L, sunEl: -2 })).toBe(0);
  });
});
