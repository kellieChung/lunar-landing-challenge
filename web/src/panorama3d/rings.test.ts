import { describe, expect, it } from 'vitest';
import { exaggerateEl } from './mapping';
import { maxMask, ringPositions } from './rings';

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
