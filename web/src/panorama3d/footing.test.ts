import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFooting, jackSpots, settle, tiltWithGround } from './footing';

describe('addFooting', () => {
  it('never puts two jacks on the same spot', () => {
    const root = new THREE.Group();
    const side = new THREE.Group();
    side.position.x = 4;
    root.add(side);
    addFooting(root, { feet: [[0, 0], [4, 0]] });
    addFooting(root, { node: side, feet: [[0, 0], [0.1, 0.1], [2, 0]] }); // (0, 0) here is (4, 0) in the root
    expect(jackSpots(root)).toEqual([[0, 0], [4, 0], [6, 0]]);
  });
});

describe('settle', () => {
  it('levels a structure on its highest foot and jacks the rest down to the ground', () => {
    const root = new THREE.Group();
    addFooting(root, { feet: [[-2, 0], [2, 0]] });
    const lift = settle(root, (u) => -0.25 * u); // falls 1 m over the 4 m between the feet
    expect(lift).toBeCloseTo(0.5); // stands on the uphill foot
    const columns = root.children.map((jack) => jack as THREE.Group);
    expect(columns[0].visible).toBe(false); // uphill: no jack needed
    expect(columns[1].visible).toBe(true);
    expect((columns[1].children[0] as THREE.Mesh).scale.y).toBeCloseTo(1); // downhill: a 1 m jack
  });

  it('tilts a vehicle with the ground under its wheels', () => {
    const rover = new THREE.Group();
    tiltWithGround(rover, 1, 1);
    expect(settle(rover, (u) => 0.1 * u)).toBe(0);
    expect(rover.rotation.z).toBeCloseTo(Math.atan(0.1));
    expect(rover.rotation.x).toBeCloseTo(0);
  });
});
