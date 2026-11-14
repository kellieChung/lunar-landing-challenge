// Deep-space environment: multi-magnitude celestial starfield, distant Earth,
// and soft lunar limb glow for the 3D globe and surface panorama.

import * as THREE from 'three';

/** Seeded PRNG for reproducible stellar coordinates and colors. */
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

/** Star circular glow sprite texture. */
function starTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Astrophysical stellar classification spectral colors
const STELLAR_COLORS = [
  new THREE.Color(0xa5c4ff), // O/B: hot blue-white (~15%)
  new THREE.Color(0xf8f9ff), // A/F: white (~45%)
  new THREE.Color(0xfff4e8), // G: yellow-white like the Sun (~25%)
  new THREE.Color(0xffd2a1), // K/M: orange/red giant (~15%)
];

/**
 * Creates a celestial starfield of multi-magnitude stars distributed over a sphere.
 * Stars vary in brightness (apparent size & opacity) and spectral color temperature.
 */
export function createStarfield(radius = 70, count = 3500): THREE.Points {
  const rng = mulberry32(19690720); // Apollo 11 landing date seed
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  const tmpColor = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Uniform spherical distribution with subtle Milky Way clustering along a galactic band
    let u = rng() * 2 - 1;
    let theta = rng() * Math.PI * 2;

    // 40% of stars cluster near an inclined galactic plane (tilt ~60 deg)
    if (rng() < 0.45) {
      const gTilt = 1.05; // radians (~60 deg)
      const gBand = (rng() - 0.5) * 0.45; // narrow band around equator
      u = Math.sin(gBand * Math.cos(gTilt) + (rng() - 0.5) * 0.35);
    }

    const r = Math.sqrt(Math.max(0, 1 - u * u));
    positions[i * 3] = radius * r * Math.cos(theta);
    positions[i * 3 + 1] = radius * u;
    positions[i * 3 + 2] = radius * r * Math.sin(theta);

    // Magnitude distribution: power-law (many faint, few bright)
    const mag = Math.pow(rng(), 3.5);
    const starType = rng();
    const baseColor =
      starType < 0.15 ? STELLAR_COLORS[0] :
      starType < 0.60 ? STELLAR_COLORS[1] :
      starType < 0.85 ? STELLAR_COLORS[2] :
      STELLAR_COLORS[3];

    // Faint stars have lower intensity; bright stars pop
    const intensity = 0.35 + 0.65 * mag;
    tmpColor.copy(baseColor).multiplyScalar(intensity);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.95,
    map: starTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.renderOrder = -100;
  points.frustumCulled = false;
  return points;
}

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform vec3 lightDir;
  uniform vec3 oceanColor;
  uniform vec3 cloudColor;
  uniform vec3 nightColor;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float nDotL = dot(n, lightDir);
    float lit = smoothstep(-0.06, 0.08, nDotL);
    
    // Atmospheric limb scattering
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float fresnel = pow(1.0 - max(0.0, dot(n, viewDir)), 2.2);
    vec3 atmoGlow = vec3(0.35, 0.65, 1.0) * fresnel * (0.3 + 0.7 * lit);

    vec3 day = mix(oceanColor, cloudColor, 0.35) + atmoGlow;
    gl_FragColor = vec4(mix(nightColor, day, lit), 1.0);
    #include <colorspace_fragment>
  }
`;

export interface DistantEarth {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  setLightDir(dir: THREE.Vector3): void;
}

/**
 * Creates a distant Earth sphere hanging in cislunar space.
 */
export function createDistantEarth(distance = 28, radius = 0.75): DistantEarth {
  const geo = new THREE.SphereGeometry(radius, 32, 24);
  const material = new THREE.ShaderMaterial({
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
    uniforms: {
      lightDir: { value: new THREE.Vector3(-1, 0.8, 0.6).normalize() },
      oceanColor: { value: new THREE.Color(0x1a4b8c) },
      cloudColor: { value: new THREE.Color(0xdde8fa) },
      nightColor: { value: new THREE.Color(0x020306) },
    },
    depthTest: true,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geo, material);
  // Position in the sky ~18 deg off the Earth-facing axis (+X) toward the horizon
  // so it creates an iconic cislunar composition in the picker
  const pos = new THREE.Vector3(distance * 0.88, distance * 0.28, -distance * 0.38);
  mesh.position.copy(pos);
  mesh.renderOrder = -50;
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    setLightDir: (dir: THREE.Vector3) => {
      material.uniforms.lightDir.value.copy(dir).normalize();
    },
  };
}

const HALO_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAG = /* glsl */ `
  uniform vec3 haloColor;
  varying vec3 vNormal;
  void main() {
    // Fresnel limb glow: strongest at grazing edges
    float fresnel = 1.0 - abs(vNormal.z);
    float glow = pow(fresnel, 3.2) * 0.32;
    gl_FragColor = vec4(haloColor, glow);
    #include <colorspace_fragment>
  }
`;

/**
 * Creates a soft lunar limb glow shell around the Moon silhouette.
 */
export function createLimbHalo(moonRadius = 1.0): THREE.Mesh {
  const geo = new THREE.SphereGeometry(moonRadius * 1.02, 48, 36);
  const mat = new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: {
      haloColor: { value: new THREE.Color(0xb5d0ee) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
