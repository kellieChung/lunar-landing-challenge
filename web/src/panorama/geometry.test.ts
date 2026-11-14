import { describe, expect, it } from 'vitest';
import { azToX, elToY, fitVertical, maskAt, vecToAzEl, wrapDeg, wrapSigned, xToAz } from './geometry';

describe('wrapDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(wrapDeg(0)).toBe(0);
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(-10)).toBe(350);
    expect(wrapDeg(725)).toBe(5);
  });
  it('wrapSigned gives [-180, 180)', () => {
    expect(wrapSigned(190)).toBe(-170);
    expect(wrapSigned(-190)).toBe(170);
    expect(wrapSigned(180)).toBe(-180);
  });
});

describe('maskAt', () => {
  const mask = Array.from({ length: 360 }, (_, i) => i / 100); // 0.00 .. 3.59
  it('returns exact values on whole degrees', () => {
    expect(maskAt(mask, 10)).toBeCloseTo(0.1, 10);
  });
  it('interpolates between degrees', () => {
    expect(maskAt(mask, 10.5)).toBeCloseTo(0.105, 10);
  });
  it('wraps between 359 and 0', () => {
    expect(maskAt(mask, 359.5)).toBeCloseTo((3.59 + 0) / 2, 10);
    expect(maskAt(mask, -0.5)).toBeCloseTo((3.59 + 0) / 2, 10);
    expect(maskAt(mask, 360)).toBeCloseTo(0, 10);
  });
});

describe('vecToAzEl', () => {
  it('handles cardinal directions', () => {
    expect(vecToAzEl(0, 1, 0)).toEqual({ az: 0, el: 0 });
    expect(vecToAzEl(1, 0, 0).az).toBeCloseTo(90, 10);
    expect(vecToAzEl(0, -1, 0).az).toBeCloseTo(180, 10);
    expect(vecToAzEl(-1, 0, 0).az).toBeCloseTo(270, 10);
    expect(vecToAzEl(0, 0, 1).el).toBeCloseTo(90, 10);
  });
  it('handles non-unit vectors', () => {
    const { az, el } = vecToAzEl(2, 2, 0);
    expect(az).toBeCloseTo(45, 10);
    expect(el).toBeCloseTo(0, 10);
  });
});

describe('screen mapping', () => {
  it('puts yaw at the center and wraps across the seam', () => {
    expect(azToX(90, 90, 2, 720)).toBe(360);
    expect(azToX(5, 355, 2, 720)).toBe(360 + 20); // 10 deg right of view, across 0/360
    expect(azToX(345, 5, 2, 720)).toBe(360 - 40);
  });
  it('xToAz inverts azToX', () => {
    expect(xToAz(azToX(12.5, 300, 3, 1080), 300, 3, 1080)).toBeCloseTo(12.5, 10);
  });
  it('elToY goes up for positive elevation', () => {
    expect(elToY(2, 500, 50)).toBe(400);
    expect(elToY(-1, 500, 50)).toBe(550);
  });
});

describe('fitVertical', () => {
  it('fits the whole range between the paddings when that needs less than the max stretch', () => {
    // 4 px/deg, range -2..+10 deg (12 deg) into 400 - 30 - 10 = 360 px -> 7.5x
    const { exaggeration, horizonY } = fitVertical(400, 4, -2, 10, 10, 30, 10);
    expect(exaggeration).toBeCloseTo(7.5, 10);
    expect(horizonY).toBeCloseTo(30 + 10 * 4 * 7.5, 10); // top of range lands on topPad
    expect(elToY(10, horizonY, 4 * exaggeration)).toBeCloseTo(30, 10);
    expect(elToY(-2, horizonY, 4 * exaggeration)).toBeCloseTo(390, 10);
  });
  it('never stretches more than the maximum', () => {
    const { exaggeration, horizonY } = fitVertical(2000, 4, -1, 2, 10, 30, 10);
    expect(exaggeration).toBe(10);
    expect(horizonY).toBeCloseTo(30 + 2 * 40, 10);
  });
});
