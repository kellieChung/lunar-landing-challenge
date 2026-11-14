import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDistantEarth, createLimbHalo, createStarfield } from './spaceEnvironment';

describe('createStarfield', () => {
  it('creates the requested number of star vertices with colors', () => {
    const count = 500;
    const stars = createStarfield(60, count);
    const pos = stars.geometry.getAttribute('position');
    const col = stars.geometry.getAttribute('color');

    expect(pos.count).toBe(count);
    expect(col.count).toBe(count);

    // Verify coordinates lie on the celestial sphere of radius ~60
    for (let i = 0; i < 20; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      expect(Math.hypot(x, y, z)).toBeCloseTo(60, 1);
    }
  });
});

describe('createDistantEarth', () => {
  it('initializes Earth mesh and allows updating light direction', () => {
    const earth = createDistantEarth(30, 0.85);
    expect(earth.mesh).toBeInstanceOf(THREE.Mesh);
    expect(earth.mesh.position.length()).toBeCloseTo(30, 1);

    const dir = new THREE.Vector3(1, 0, 0);
    earth.setLightDir(dir);
    const lightVal = earth.material.uniforms.lightDir.value as THREE.Vector3;
    expect(lightVal.x).toBeCloseTo(1, 5);
  });
});

describe('createLimbHalo', () => {
  it('creates a slightly enlarged halo shell', () => {
    const halo = createLimbHalo(1.0);
    expect(halo).toBeInstanceOf(THREE.Mesh);
    expect((halo.material as THREE.ShaderMaterial).transparent).toBe(true);
  });
});
