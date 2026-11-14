import { describe, expect, it } from 'vitest';
import type { TerrainHeader } from '../data/types';
import { clampToMask, heightAt, parseTerrain, terrainIndex, terrainPositions, type Heightmap } from './heightmap';

const header = (nx: number, ny: number): TerrainHeader => ({
  file: 'x.bin', format: 'float32-le', nx, ny, spacing_m: 100, x0_m: -100, y0_m: -100,
  ground_m: 0, order: '', z: '',
});

function grid(values: number[], nx = 3, ny = 3): Heightmap {
  return { nx, ny, spacing: 100, x0: -100, y0: -100, z: Float32Array.from(values) };
}

describe('parseTerrain', () => {
  it('reads little-endian float32 in row order', () => {
    const buf = new ArrayBuffer(9 * 4);
    const view = new DataView(buf);
    for (let i = 0; i < 9; i++) view.setFloat32(i * 4, i * 1.5, true);
    const t = parseTerrain(buf, header(3, 3));
    expect(Array.from(t.z)).toEqual([0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12]);
  });
  it('rejects a file of the wrong size', () => {
    expect(() => parseTerrain(new ArrayBuffer(8), header(3, 3))).toThrow(/expected 36/);
  });
});

describe('heightAt', () => {
  // Row j is y = -100 + 100 j (south to north); column i is x = -100 + 100 i.
  const t = grid([0, 1, 2, 10, 11, 12, 20, 21, 22]);
  it('returns vertex values', () => {
    expect(heightAt(t, -100, -100)).toBe(0);
    expect(heightAt(t, 100, -100)).toBe(2); // east end of the south row
    expect(heightAt(t, -100, 100)).toBe(20); // west end of the north row
    expect(heightAt(t, 100, 100)).toBe(22);
  });
  it('interpolates bilinearly', () => {
    expect(heightAt(t, -50, -50)).toBeCloseTo(5.5, 6);
    expect(heightAt(t, 0, 50)).toBeCloseTo(16, 6);
  });
  it('is NaN outside the grid', () => {
    expect(heightAt(t, 101, 0)).toBeNaN();
  });
});

describe('mesh geometry', () => {
  it('places column i east (+x) and row j north (-z), eye at the origin', () => {
    const pos = terrainPositions(grid(new Array(9).fill(0)), 3);
    expect(Array.from(pos.subarray(2 * 3, 2 * 3 + 3))).toEqual([100, -3, 100]); // i=2, j=0: east, south
    expect(Array.from(pos.subarray(6 * 3, 6 * 3 + 3))).toEqual([-100, -3, -100]); // i=0, j=2: west, north
  });

  it('winds triangles so flat ground faces up', () => {
    const pos = terrainPositions(grid(new Array(9).fill(0)), 0);
    const idx = terrainIndex(3, 3);
    expect(idx.length).toBe(2 * 2 * 6);
    for (let f = 0; f < idx.length; f += 3) {
      const p = [0, 1, 2].map((q) => Array.from(pos.subarray(idx[f + q] * 3, idx[f + q] * 3 + 3)));
      const u = p[1].map((v, i) => v - p[0][i]);
      const w = p[2].map((v, i) => v - p[0][i]);
      const ny = u[2] * w[0] - u[0] * w[2]; // y component of u x w
      expect(ny).toBeGreaterThan(0);
    }
  });
});

describe('clampToMask', () => {
  it('lowers only vertices above the horizon, exactly onto it', () => {
    const pos = terrainPositions(grid([0, 0, 0, 0, 0, 500, 0, 0, 0]), 3); // a 500 m spike 100 m east
    const near = new Array(360).fill(5); // horizon at 5 deg everywhere
    const before = Array.from(pos);
    expect(clampToMask(pos, near, near)).toBe(1);
    const v = 5; // i=2, j=1: x = 100, y = 0
    expect(pos[v * 3 + 1]).toBeCloseTo(100 * Math.tan((5 * Math.PI) / 180), 3);
    pos.forEach((value, i) => {
      if (i !== v * 3 + 1) expect(value).toBe(before[i]);
    });
  });
});
