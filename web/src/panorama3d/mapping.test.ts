import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { vecToAzEl } from '../panorama/geometry';
import {
  azElToEnu, cameraEuler, defaultPitch, enuToThree, exaggerateEl, exaggerateEnu, fitExaggeration3D,
} from './mapping';

describe('exaggeration', () => {
  it('k = 1 is the identity', () => {
    const v = azElToEnu(123, 4.5);
    exaggerateEnu(v, 1).forEach((c, i) => expect(c).toBeCloseTo(v[i], 12));
    expect(exaggerateEl(4.5, 1)).toBeCloseTo(4.5, 12);
  });

  it('keeps azimuth and shows elevation at atan(k tan el)', () => {
    for (const [az, el] of [[10, 2], [200, -3], [359, 7.09]]) {
      const shown = vecToAzEl(...exaggerateEnu(azElToEnu(az, el), 5));
      expect(shown.az).toBeCloseTo(az, 9);
      expect(shown.el).toBeCloseTo(exaggerateEl(el, 5), 9);
      expect(shown.el).toBeCloseTo((Math.atan(5 * Math.tan((el * Math.PI) / 180)) * 180) / Math.PI, 9);
    }
  });

  it('is monotone, so order (Sun above or below a ridge) is kept', () => {
    let prev = -Infinity;
    for (let el = -30; el <= 30; el += 0.25) {
      const s = exaggerateEl(el, 10);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it('a terrain point with its height scaled by k appears at exaggerateEl', () => {
    const d = 3000;
    const z = 250;
    const trueEl = (Math.atan2(z, d) * 180) / Math.PI;
    expect((Math.atan2(4 * z, d) * 180) / Math.PI).toBeCloseTo(exaggerateEl(trueEl, 4), 9);
  });
});

describe('fitExaggeration3D', () => {
  it('uses the maximum when the range is small', () => {
    expect(fitExaggeration3D(-0.5, 1, 54, 10)).toBe(10);
  });
  it('falls back to true scale when even k = 1 does not fit', () => {
    expect(fitExaggeration3D(-40, 40, 54, 10)).toBe(1);
  });
  it('otherwise fills the usable span exactly', () => {
    const k = fitExaggeration3D(-2.32, 10.27, 54, 10);
    expect(exaggerateEl(10.27, k) - exaggerateEl(-2.32, k)).toBeCloseTo(54, 6);
    expect(k).toBeGreaterThan(4);
    expect(k).toBeLessThan(6);
  });
  it('default pitch centers the shown range', () => {
    expect(defaultPitch(-2, 2, 1)).toBeCloseTo(0, 12);
  });
});

describe('axes', () => {
  it('maps east to +x, up to +y, north to -z', () => {
    expect(enuToThree([1, 0, 0])).toEqual([1, 0, -0]);
    expect(enuToThree([0, 0, 1])).toEqual([0, 1, -0]);
    expect(enuToThree([0, 1, 0])).toEqual([0, 0, -1]);
  });

  it.each([[0, [0, 0, -1]], [90, [1, 0, 0]], [180, [0, 0, 1]], [270, [-1, 0, 0]]])(
    'camera at yaw %d looks along the matching azimuth',
    (yaw, expected) => {
      const e = cameraEuler(yaw as number, 0);
      const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(e.x, e.y, e.z, e.order));
      (expected as number[]).forEach((c, i) => expect(look.toArray()[i]).toBeCloseTo(c, 9));
      const want = enuToThree(azElToEnu(yaw as number, 0));
      want.forEach((c, i) => expect(look.toArray()[i]).toBeCloseTo(c, 9));
    },
  );

  it('positive pitch looks up', () => {
    const e = cameraEuler(90, 20);
    const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(e.x, e.y, e.z, e.order));
    const want = enuToThree(azElToEnu(90, 20));
    want.forEach((c, i) => expect(look.toArray()[i]).toBeCloseTo(c, 9));
  });
});
