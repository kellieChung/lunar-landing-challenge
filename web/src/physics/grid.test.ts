import { describe, expect, it } from 'vitest';
import type { GridPoint } from '../data/types';
import { describeOffset, findPoint, pointAxes, pointVectors } from './grid';

const R_KM = 1737.4;

describe('pointAxes', () => {
  it.each([[0.002, -0.0015], [-0.0029, 0.0029], [0, 0.0029]])('is orthonormal and right-handed (%f, %f)', (te, tn) => {
    const [e, n, u] = pointAxes([te, tn]);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const [a, b, want] of [[e, e, 1], [n, n, 1], [u, u, 1], [e, n, 0], [e, u, 0], [n, u, 0]] as const) {
      expect(Math.abs(dot(a, b) - want)).toBeLessThan(1e-15);
    }
    const cross = [e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0]];
    cross.forEach((c, k) => expect(Math.abs(c - u[k])).toBeLessThan(1e-15));
  });
});

describe('pointVectors', () => {
  it('returns the same series at tilt (0, 0)', () => {
    const v = { e: [0.1], n: [0.2], u: [0.97], r_au: [1] };
    expect(pointVectors(v, [0, 0])).toBe(v);
  });
  it('the center zenith seen from 5 km east leans west by 5 km / R', () => {
    const te = 5 / R_KM;
    const out = pointVectors({ e: [0], n: [0], u: [1] }, [te, 0]);
    const el = (Math.asin(out.u[0]) * 180) / Math.PI;
    expect(el).toBeCloseTo(90 - (Math.asin(te) * 180) / Math.PI, 6); // tilt = sine of the lean
    expect(out.e[0]).toBeLessThan(0); // west
    expect(Math.abs(out.n[0])).toBeLessThan(1e-15);
  });
  it('keeps the other fields', () => {
    const out = pointVectors({ e: [1], n: [0], u: [0], r_au: [0.99] }, [0.001, 0.001]);
    expect(out.r_au).toEqual([0.99]);
  });
});

describe('findPoint', () => {
  const pt = (i: number, j: number): GridPoint => ({
    i, j, dx_km: i, dy_km: j, up_tilt: [0, 0], mask_deg: [],
  });
  const points = [pt(-1, -1), pt(0, -1), pt(0, 0), pt(1, 1)];
  it('defaults to the center (by offset, not list position)', () => {
    expect(findPoint(points, null)).toBe(points[2]);
    expect(findPoint(points, 'nonsense')).toBe(points[2]);
    expect(findPoint(points, '7,7')).toBe(points[2]);
  });
  it('finds i,j', () => {
    expect(findPoint(points, '-1,-1')).toBe(points[0]);
    expect(findPoint(points, '1,1')).toBe(points[3]);
  });
});

describe('describeOffset', () => {
  it('names the direction', () => {
    expect(describeOffset(0, 0)).toBe('Site center');
    expect(describeOffset(2, 1)).toBe('2 km E, 1 km N of the site center');
    expect(describeOffset(-3, 0)).toBe('3 km W of the site center');
    expect(describeOffset(0, -5)).toBe('5 km S of the site center');
  });
});
