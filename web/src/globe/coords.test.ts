import { describe, expect, it } from 'vitest';
import { formatLatLon, latLonToVec } from './coords';

function expectVec(v: number[], want: number[]) {
  v.forEach((c, i) => expect(c).toBeCloseTo(want[i], 12));
}

describe('latLonToVec', () => {
  it('puts the poles on the Y axis', () => {
    expectVec(latLonToVec(90, 0), [0, 1, 0]);
    expectVec(latLonToVec(-90, 123), [0, -1, 0]);
  });
  it('puts lon 0 (Earth-facing) on +X', () => {
    expectVec(latLonToVec(0, 0), [1, 0, 0]);
  });
  it('puts 90 deg E on -Z, so the globe is not mirrored', () => {
    expectVec(latLonToVec(0, 90), [0, 0, -1]);
    expectVec(latLonToVec(0, -90), [0, 0, 1]);
  });
  it('returns unit vectors', () => {
    const [x, y, z] = latLonToVec(-84.20156, 60.69989);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });
});

describe('formatLatLon', () => {
  it('formats hemispheres', () => {
    expect(formatLatLon(-84.20156, 60.69989)).toBe('84.20° S, 60.70° E');
    expect(formatLatLon(10, 350)).toBe('10.00° N, 10.00° W');
  });
});
