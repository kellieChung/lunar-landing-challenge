import { describe, expect, it } from 'vitest';
import { earthRadiusDeg, sunRadiusDeg } from '../physics/constants';
import { azElToEnu, exaggerateEnu, type Vec3 } from './mapping';
import { earthLitFraction, earthPhaseLight } from './sky';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const shownFraction = (L: Vec3, earthShown: Vec3) => (1 + dot(L, earthShown.map((c) => -c) as Vec3)) / 2;

describe('Earth phase', () => {
  it('lit fraction is 1 with the Sun behind us, 0 behind Earth, 0.5 at 90 deg', () => {
    const earth = azElToEnu(300, 2);
    expect(earthLitFraction(azElToEnu(120, -2), earth)).toBeCloseTo(1, 9);
    expect(earthLitFraction(earth, earth)).toBeCloseTo(0, 9);
    expect(earthLitFraction(azElToEnu(30, 0), azElToEnu(300, 0))).toBeCloseTo(0.5, 9);
  });

  it('at k = 1 the phase light is the true Sun direction', () => {
    const sun = azElToEnu(80, 1.5);
    const earth = azElToEnu(305, 4);
    const L = earthPhaseLight(sun, earth, sun, earth);
    L.forEach((c, i) => expect(c).toBeCloseTo(sun[i], 9));
  });

  it('keeps the true lit fraction and points the bright edge at the shown Sun when stretched', () => {
    const sun = azElToEnu(80, 1.5);
    const earth = azElToEnu(305, 4);
    const sunShown = exaggerateEnu(sun, 6);
    const earthShown = exaggerateEnu(earth, 6);
    const L = earthPhaseLight(sun, earth, sunShown, earthShown);
    expect(shownFraction(L, earthShown)).toBeCloseTo(earthLitFraction(sun, earth), 9);
    // The light's sideways part (across the disk) points toward the shown Sun.
    const side = (v: Vec3) => v.map((c, i) => c - dot(v, earthShown) * earthShown[i]) as Vec3;
    expect(dot(side(L), side(sunShown))).toBeGreaterThan(0);
  });
});

describe('angular sizes', () => {
  it('Sun at 1 AU is about 0.2666 deg in radius', () => {
    expect(sunRadiusDeg(1)).toBeCloseTo(0.2665, 3);
  });
  it('Earth at 384,400 km is about 0.95 deg in radius (~3.6x the Sun)', () => {
    expect(earthRadiusDeg(384_400)).toBeCloseTo(0.9496, 3);
  });
});
