// Regolith look for the near terrain (rendering only). A small tiling noise
// texture of fine speckle and soft blotches; combined with the large-scale
// vertex mottling (heightmap.ts terrainColors) it never looks like one tile.

import * as THREE from 'three';

/** Tiny seeded generator so the texture is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function regolithTexture(anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(7);
  g.fillStyle = 'rgb(200,200,200)';
  g.fillRect(0, 0, size, size);
  // Soft blotches (drawn 9 times shifted so the texture tiles seamlessly).
  for (let i = 0; i < 60; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 6 + rnd() * 26;
    const v = 150 + rnd() * 100;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
        grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
      }
    }
  }
  // Fine speckle.
  const img = g.getImageData(0, 0, size, size);
  for (let p = 0; p < img.data.length; p += 4) {
    const d = (rnd() - 0.5) * 50;
    img.data[p] += d;
    img.data[p + 1] += d;
    img.data[p + 2] += d;
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}
