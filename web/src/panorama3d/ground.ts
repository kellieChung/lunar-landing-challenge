// Regolith and mountain ridge look for the 3D landing site simulation (rendering only).
// Provides seamless high-resolution surface textures, bump relief for grazing sunlight,
// and natural mountain strata for the distant skyline rings.

import * as THREE from 'three';

/** Seeded PRNG so procedural textures are deterministic across reloads. */
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

/**
 * High-resolution 1024x1024 seamless lunar regolith albedo texture.
 * Features natural highland mottling, multi-scale craterlets with raised rims and ejecta,
 * rocky boulder scatter, and powdery regolith dust speckle.
 */
export function regolithTexture(anisotropy: number): THREE.CanvasTexture {
  if (typeof document === 'undefined') return new THREE.CanvasTexture({} as any);

  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(19690720);

  // Base highland regolith tone (anorthosite grey, typical of lunar south-pole highlands)
  g.fillStyle = 'rgb(188, 191, 196)';
  g.fillRect(0, 0, size, size);

  // 1. Soft multi-scale blotches (seamless 9-tile wrapping)
  for (let i = 0; i < 160; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 16 + rnd() * 80;
    const v = 140 + rnd() * 105;
    const alpha = 0.16 + rnd() * 0.24;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, `rgba(${v},${v},${v + 2},${alpha})`);
        grad.addColorStop(1, `rgba(${v},${v},${v + 2},0)`);
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
      }
    }
  }

  // 2. Multi-scale craterlets with bright rims, dark bowls, and radial ejecta
  for (let i = 0; i < 65; i++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const cr = 4 + rnd() * 26;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const px = cx + dx;
        const py = cy + dy;

        // Subtle faint ejecta rays for medium/larger craters
        if (cr > 14) {
          const rayGrad = g.createRadialGradient(px, py, cr * 1.1, px, py, cr * 2.8);
          rayGrad.addColorStop(0, 'rgba(235, 238, 245, 0.28)');
          rayGrad.addColorStop(1, 'rgba(200, 202, 208, 0)');
          g.fillStyle = rayGrad;
          g.fillRect(px - cr * 2.8, py - cr * 2.8, cr * 5.6, cr * 5.6);
        }

        // Raised bright rim
        const rimGrad = g.createRadialGradient(px, py, cr * 0.7, px, py, cr * 1.35);
        rimGrad.addColorStop(0, 'rgba(240, 242, 248, 0.55)');
        rimGrad.addColorStop(0.5, 'rgba(220, 222, 228, 0.3)');
        rimGrad.addColorStop(1, 'rgba(195, 195, 195, 0)');
        g.fillStyle = rimGrad;
        g.fillRect(px - cr * 1.35, py - cr * 1.35, cr * 2.7, cr * 2.7);

        // Depressed shadowed floor
        const floorGrad = g.createRadialGradient(px - cr * 0.2, py - cr * 0.2, 0, px, py, cr * 0.85);
        floorGrad.addColorStop(0, 'rgba(110, 112, 118, 0.65)');
        floorGrad.addColorStop(0.8, 'rgba(145, 147, 154, 0.4)');
        floorGrad.addColorStop(1, 'rgba(188, 190, 195, 0)');
        g.fillStyle = floorGrad;
        g.fillRect(px - cr, py - cr, cr * 2, cr * 2);
      }
    }
  }

  // 3. Angular rock and boulder scatter
  for (let i = 0; i < 90; i++) {
    const rx = rnd() * size;
    const ry = rnd() * size;
    const rw = 2 + rnd() * 6;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const px = rx + dx;
        const py = ry + dy;
        // Shadow side (southeast)
        g.fillStyle = 'rgba(80, 82, 88, 0.75)';
        g.fillRect(px, py, rw, rw);
        // Sunlit edge (northwest)
        g.fillStyle = 'rgba(245, 248, 255, 0.85)';
        g.fillRect(px - 1, py - 1, Math.max(1, rw * 0.6), Math.max(1, rw * 0.6));
      }
    }
  }

  // 4. Fine regolith dust speckle
  const img = g.getImageData(0, 0, size, size);
  for (let p = 0; p < img.data.length; p += 4) {
    const d = (rnd() - 0.5) * 40;
    img.data[p] = Math.min(255, Math.max(0, img.data[p] + d));
    img.data[p + 1] = Math.min(255, Math.max(0, img.data[p + 1] + d));
    img.data[p + 2] = Math.min(255, Math.max(0, img.data[p + 2] + d + 1));
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * 1024x1024 surface bump map for the near terrain.
 * Adds tactile micro-relief so grazing sunlight catches crater rims and rocks.
 */
export function regolithBumpTexture(anisotropy: number): THREE.CanvasTexture {
  if (typeof document === 'undefined') return new THREE.CanvasTexture({} as any);

  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(19690720); // matching seed

  // Neutral elevation = 128
  g.fillStyle = 'rgb(128, 128, 128)';
  g.fillRect(0, 0, size, size);

  // Soft low-frequency undulating terrain
  for (let i = 0; i < 110; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 20 + rnd() * 60;
    const v = (rnd() - 0.5) * 60;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        const col = 128 + v;
        grad.addColorStop(0, `rgba(${col},${col},${col},0.3)`);
        grad.addColorStop(1, 'rgba(128,128,128,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
      }
    }
  }

  // Matching crater rims (raised = 190-235) and depressions (depressed = 45-85)
  for (let i = 0; i < 65; i++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const cr = 4 + rnd() * 26;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const px = cx + dx;
        const py = cy + dy;
        // Raised rim
        const rim = g.createRadialGradient(px, py, cr * 0.72, px, py, cr * 1.35);
        rim.addColorStop(0, 'rgba(215, 215, 215, 0.65)');
        rim.addColorStop(1, 'rgba(128, 128, 128, 0)');
        g.fillStyle = rim;
        g.fillRect(px - cr * 1.35, py - cr * 1.35, cr * 2.7, cr * 2.7);

        // Depressed bowl
        const bowl = g.createRadialGradient(px, py, 0, px, py, cr * 0.85);
        bowl.addColorStop(0, 'rgba(55, 55, 55, 0.75)');
        bowl.addColorStop(1, 'rgba(128, 128, 128, 0)');
        g.fillStyle = bowl;
        g.fillRect(px - cr, py - cr, cr * 2, cr * 2);
      }
    }
  }

  // Matching rock boulders (raised sharp spikes = 210-245)
  for (let i = 0; i < 90; i++) {
    const rx = rnd() * size;
    const ry = rnd() * size;
    const rw = 2 + rnd() * 6;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        g.fillStyle = 'rgba(225, 225, 225, 0.85)';
        g.fillRect(rx + dx, ry + dy, rw, rw);
      }
    }
  }

  // Fine surface grain
  const img = g.getImageData(0, 0, size, size);
  for (let p = 0; p < img.data.length; p += 4) {
    const d = (rnd() - 0.5) * 35;
    const val = Math.min(255, Math.max(0, img.data[p] + d));
    img.data[p] = img.data[p + 1] = img.data[p + 2] = val;
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * 1024x512 seamless horizontal rock and strata texture for the distant skyline rings.
 * Transforms flat single-color polygonal curtains into realistic layered lunar mountains.
 */
export function ridgeTexture(anisotropy: number): THREE.CanvasTexture {
  if (typeof document === 'undefined') return new THREE.CanvasTexture({} as any);

  const width = 1024;
  const height = 512;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(19721219); // Apollo 17 seed

  // Neutral high-contrast base
  g.fillStyle = 'rgb(215, 218, 222)';
  g.fillRect(0, 0, width, height);

  // 1. Horizontal geological bedding & strata (megaregolith layers)
  for (let y = 0; y < height; y += 4 + Math.floor(rnd() * 8)) {
    const h = 2 + Math.floor(rnd() * 6);
    const v = 160 + rnd() * 80;
    const alpha = 0.22 + rnd() * 0.25;
    g.fillStyle = `rgba(${v},${v},${v + 2},${alpha})`;
    g.fillRect(0, y, width, h);
  }

  // 2. Vertical and diagonal scree chutes and avalanche gullies
  for (let i = 0; i < 110; i++) {
    const x = rnd() * width;
    const w = 4 + rnd() * 20;
    const v = 135 + rnd() * 85;
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, `rgba(${v},${v},${v + 4},0.35)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    for (const dx of [-width, 0, width]) {
      g.fillRect(x + dx, 0, w, height);
    }
  }

  // 3. Crisp horizontal shelf ledges (impact basin terrace edges)
  for (let i = 0; i < 24; i++) {
    const y = rnd() * height;
    g.fillStyle = 'rgba(245, 248, 255, 0.45)';
    g.fillRect(0, y, width, 2);
    g.fillStyle = 'rgba(80, 85, 95, 0.4)';
    g.fillRect(0, y + 2, width, 4);
  }

  // 4. Rock roughness noise
  const img = g.getImageData(0, 0, width, height);
  for (let p = 0; p < img.data.length; p += 4) {
    const d = (rnd() - 0.5) * 35;
    img.data[p] = Math.min(255, Math.max(0, img.data[p] + d));
    img.data[p + 1] = Math.min(255, Math.max(0, img.data[p + 1] + d));
    img.data[p + 2] = Math.min(255, Math.max(0, img.data[p + 2] + d + 1));
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}
