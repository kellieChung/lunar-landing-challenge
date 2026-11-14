import { describe, expect, it } from 'vitest';
import type { TerrainHeader } from '../data/types';
import {
  clampToMask, crop, heightAt, heightOnMesh, parseTerrain, recenter, terrainColors, terrainIndex, terrainPositions, terrainUVs,
  type Heightmap,
} from './heightmap';

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

describe('heightOnMesh', () => {
  // One cell: a (0,0)=0, b (1,0)=10, c (0,1)=20, d (1,1)=100.
  const t: Heightmap = { nx: 2, ny: 2, spacing: 100, x0: 0, y0: 0, z: Float32Array.from([0, 10, 20, 100]) };
  it('equals the vertex heights at the corners', () => {
    expect(heightOnMesh(t, 0, 0)).toBeCloseTo(0, 9);
    expect(heightOnMesh(t, 100, 0)).toBeCloseTo(10, 9);
    expect(heightOnMesh(t, 0, 100)).toBeCloseTo(20, 9);
    expect(heightOnMesh(t, 100, 100)).toBeCloseTo(100, 9);
  });
  it('lies on the drawn triangles, not the bilinear surface', () => {
    // Center of the cell is on the b-c diagonal: mean of b and c.
    expect(heightOnMesh(t, 50, 50)).toBeCloseTo(15, 9);
    expect(heightAt(t, 50, 50)).toBeCloseTo(32.5, 9); // bilinear differs
    // Inside triangle b, d, c.
    expect(heightOnMesh(t, 75, 75)).toBeCloseTo(100 + 0.25 * (20 - 100) + 0.25 * (10 - 100), 9);
  });
  it('is NaN outside the grid', () => {
    expect(heightOnMesh(t, -1, 50)).toBeNaN();
  });
});

describe('terrainUVs / terrainColors', () => {
  const t = grid([0, 1, 2, 10, 11, 12, 20, 21, 22]);
  it('have one entry per vertex and are deterministic', () => {
    expect(terrainUVs(t, 50).length).toBe(9 * 2);
    expect(terrainUVs(t, 50)[0]).toBeCloseTo(-2, 9); // x = -100 m / 50 m
    const c = terrainColors(t);
    expect(c.length).toBe(9 * 3);
    expect(Array.from(terrainColors(t))).toEqual(Array.from(c));
    expect(Math.min(...c)).toBeGreaterThanOrEqual(0.72);
    expect(Math.max(...c)).toBeLessThanOrEqual(1);
  });
});

describe('recenter and crop (grid points)', () => {
  // 9 x 9 vertices, 100 m apart, x and y from -400 to 400 m.
  const n = 9;
  const big = (f: (x: number, y: number) => number): Heightmap => {
    const z = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = f(-400 + 100 * i, -400 + 100 * j);
    return { nx: n, ny: n, spacing: 100, x0: -400, y0: -400, z };
  };
  const R = 1737400;

  it('is the identity at the site center', () => {
    const t = big((x, y) => x + 2 * y);
    expect(recenter(t, 0, 0)).toBe(t);
  });

  it('puts the point at the origin with zero height', () => {
    const t = big((x, y) => 50 + x * 0.1 - y * 0.05);
    const r = recenter(t, 200, -100);
    expect(r.x0).toBe(-600);
    expect(r.y0).toBe(-300);
    expect(heightAt(r, 0, 0)).toBe(0);
    // A vertex 100 m east of the point: the slope (0.1 * 100 = 10 m) plus the
    // re-levelling term r'.p / R = 100 * 200 / R.
    expect(heightAt(r, 100, 0)).toBeCloseTo(10 + (100 * 200) / R, 4);
  });

  it('turns a sphere seen from the center into a sphere seen from the point', () => {
    // Flat ground on the sphere, as seen along the center's up: z = -(x^2 + y^2) / 2R.
    const t = big((x, y) => -(x * x + y * y) / (2 * R));
    const r = recenter(t, 300, 200);
    for (const [x, y] of [[100, 0], [-300, 100], [0, -400]]) {
      expect(heightAt(r, x, y)).toBeCloseTo(-(x * x + y * y) / (2 * R), 5);
    }
  });

  it('rejects points that are not on a vertex', () => {
    expect(() => recenter(big(() => 0), 150, 0)).toThrow(/not a vertex/);
  });

  it('crops to the square around the origin', () => {
    const t = big((x, y) => x * 1000 + y);
    const c = crop(t, 200);
    expect([c.nx, c.ny, c.x0, c.y0]).toEqual([5, 5, -200, -200]);
    expect(heightAt(c, -200, -200)).toBe(t.z[2 * n + 2]);
    expect(heightAt(c, 200, 100)).toBe(200 * 1000 + 100);
    expect(crop(t, 1000)).toBe(t); // already small enough
  });

  it('crop after recenter keeps the point in the middle', () => {
    const t = big((x, y) => x + y);
    const c = crop(recenter(t, -200, 300), 150);
    expect([c.nx, c.ny, c.x0, c.y0]).toEqual([3, 3, -100, -100]);
    const edge = crop(recenter(t, 0, 300), 200); // the map ends 100 m north of this point
    expect([edge.nx, edge.ny, edge.x0, edge.y0]).toEqual([5, 4, -200, -200]);
    expect(heightAt(c, 0, 0)).toBe(0);
  });
});
