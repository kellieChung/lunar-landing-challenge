import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Effects } from '../panorama3d/effects';
import type { SceneProp } from '../panorama3d/Scene3D';
import { along, bearingDeg, pathIn, pathOut, RoverViz, toPolar, toXY, track, turn, type MoverScene } from './roverViz';

function fakeScene() {
  const movers = new Set<SceneProp>();
  const scene: MoverScene = {
    addMover: (p) => { movers.add(p); },
    placeMover: () => {},
    removeMover: (p) => { movers.delete(p); },
    groundPoint: () => new THREE.Vector3(),
    addTicker: () => () => {},
    fx: { dust: () => {} } as unknown as Effects,
  };
  return { scene, movers };
}
const rover = () => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  return g;
};
const slot = (n: number) => ({ azDeg: 60 + 9 * n, distM: 26 });
const run = (v: RoverViz, s: number) => { for (let t = 0; t < s; t += 1 / 60) v.step(1 / 60); };

describe('rover paths', () => {
  it('bearings: north is 0, east is 90', () => {
    expect(bearingDeg({ dx_km: 0, dy_km: 0 }, { dx_km: 0, dy_km: 1 })).toBeCloseTo(0);
    expect(bearingDeg({ dx_km: 0, dy_km: 0 }, { dx_km: 1, dy_km: 0 })).toBeCloseTo(90);
    expect(bearingDeg({ dx_km: 1, dy_km: 1 }, { dx_km: 1, dy_km: 0 })).toBeCloseTo(180);
  });

  it('turns the short way round', () => {
    expect(turn(350, 10)).toBeCloseTo(20);
    expect(turn(10, 350)).toBeCloseTo(-20);
  });

  it('drives out past the buildings before swinging round, never toward the viewer', () => {
    const from = toXY(slot(0));
    const pts = pathOut(from, 240); // nearly behind the slot
    const t = track(pts);
    for (let s = 0; s <= t.length; s += 5) expect(toPolar(along(t, s).p).distM).toBeGreaterThanOrEqual(25.9);
    expect(toPolar(pts[1]).azDeg).toBeCloseTo(60); // straight out along its own spoke first
    expect(toPolar(pts[pts.length - 1]).azDeg).toBeCloseTo(240);
  });

  it('comes home round the ring and straight in to its slot', () => {
    const pts = pathIn(toXY({ azDeg: 200, distM: 210 }), slot(1));
    const end = toPolar(pts[pts.length - 1]);
    expect(end.azDeg).toBeCloseTo(69);
    expect(end.distM).toBeCloseTo(26);
  });
});

describe('RoverViz', () => {
  it('snaps into place when the viewer arrives, then drives away and back', () => {
    const { scene, movers } = fakeScene();
    const v = new RoverViz(scene, rover, slot);
    v.sync([{ present: true, awayAz: null }, { present: false, awayAz: null }], true);
    expect(v.modeOf(0)).toBe('parked');
    expect(v.modeOf(1)).toBe('away');
    expect(movers.size).toBe(2); // one model per rover, kept for the run

    v.sync([{ present: false, awayAz: 180 }, { present: false, awayAz: null }], false);
    expect(v.modeOf(0)).toBe('leaving');
    run(v, 5);
    expect(v.modeOf(0)).toBe('away');

    v.sync([{ present: true, awayAz: 180 }, { present: false, awayAz: null }], false);
    expect(v.modeOf(0)).toBe('arriving');
    run(v, 5);
    expect(v.modeOf(0)).toBe('parked');
    const p = toPolar(v.positionOf(0)!);
    expect(p.azDeg).toBeCloseTo(60);
    expect(p.distM).toBeCloseTo(26);
  });

  it('turns round from where it is when it changes its mind half way', () => {
    const { scene } = fakeScene();
    const v = new RoverViz(scene, rover, slot);
    v.sync([{ present: true, awayAz: 90 }], true);
    v.sync([{ present: false, awayAz: 90 }], false);
    run(v, 1.2);
    const mid = toPolar(v.positionOf(0)!);
    expect(mid.distM).toBeGreaterThan(27); // it got going
    v.sync([{ present: true, awayAz: 90 }], false);
    expect(v.modeOf(0)).toBe('arriving');
    v.step(1 / 60);
    expect(Math.abs(toPolar(v.positionOf(0)!).distM - mid.distM)).toBeLessThan(2); // no jump
    run(v, 5);
    expect(v.modeOf(0)).toBe('parked');
  });

  it('a rover that leaves while the viewer moves away is simply gone', () => {
    const { scene } = fakeScene();
    const v = new RoverViz(scene, rover, slot);
    v.sync([{ present: true, awayAz: null }], true);
    v.sync([{ present: false, awayAz: null }], true);
    expect(v.modeOf(0)).toBe('away');
    expect(v.moving).toBe(false);
  });
});
