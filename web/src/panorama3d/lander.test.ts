import { describe, expect, it } from 'vitest';
import { landerPlacement } from './lander';

describe('landerPlacement', () => {
  it('looks the same at every stretch on flat ground (similar triangles)', () => {
    const angles = [1, 4, 10].map((k) => {
      const { pos, scale } = landerPlacement(null, 3, k, 30, 20);
      const d = Math.hypot(pos[0], pos[2]);
      return { depression: Math.atan2(-pos[1], d), size: Math.atan2(3 * scale, d) };
    });
    for (const a of angles.slice(1)) {
      expect(a.depression).toBeCloseTo(angles[0].depression, 9);
      expect(a.size).toBeCloseTo(angles[0].size, 9);
    }
  });

  it('stands at the requested azimuth', () => {
    const { pos } = landerPlacement(null, 3, 1, 90, 20);
    expect(pos[0]).toBeCloseTo(20, 9); // east
    expect(pos[2]).toBeCloseTo(0, 9);
  });
});
