// NASA's official 3D models (https://science.nasa.gov/3d-resources/), built
// into public/models/nasa/ by scripts/build-nasa-models.mjs. Loaded once,
// before the 3D view opens, so the prop builders can stay synchronous; a
// builder falls back to its own simple shape if loading failed.
//
// Rendering only. There is no environment map on purpose (light comes only
// from the physics-driven Sun and Earth), so very metallic materials are
// toned down or they would render black.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type NasaModelName = 'lm-descent' | 'lm-ascent' | 'perseverance' | 'hdu' | 'solar-array' | 'rtg';
const NAMES: NasaModelName[] = ['lm-descent', 'lm-ascent', 'perseverance', 'hdu', 'solar-array', 'rtg'];

/** Highest metalness kept: with no envMap, metal shows only its (dark) specular. */
const MAX_METALNESS = 0.35;

const loaded = new Map<NasaModelName, THREE.Object3D>();
let pending: Promise<boolean> | null = null;

/** Load every model once. Resolves false (never rejects) if any failed. */
export function loadNasaModels(): Promise<boolean> {
  if (pending) return pending;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const base = `${import.meta.env.BASE_URL}models/nasa/`;
  pending = Promise.all(NAMES.map(async (name) => {
    const gltf = await loader.loadAsync(`${base}${name}.glb`);
    const merged = mergeByMaterial(gltf.scene);
    prepare(merged);
    loaded.set(name, merged);
  })).then(() => true, (err) => {
    console.error('NASA models failed to load; using simple shapes', err);
    loaded.clear();
    return false;
  });
  return pending;
}

function prepare(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = false; // a shadow must never contradict a physics-driven panel
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m instanceof THREE.MeshStandardMaterial) m.metalness = Math.min(m.metalness, MAX_METALNESS);
    }
  });
}

/**
 * The NASA files are made of many small meshes (hundreds of draw calls per
 * model). Bake each mesh's transform into a float copy of its geometry and
 * merge the meshes that share a material, so a model costs one draw call per
 * material. The result has the same world-space shape as the source scene.
 */
function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  const out = new THREE.Group();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (Array.isArray(o.material)) {
      const copy = o.clone();
      copy.geometry = bake(o.geometry, o.matrixWorld);
      copy.matrix.identity();
      copy.matrix.decompose(copy.position, copy.quaternion, copy.scale);
      out.add(copy);
      return;
    }
    const g = bake(o.geometry, o.matrixWorld);
    const key = [o.material.uuid, Object.keys(g.attributes).sort().join(','), g.index ? 'i' : 'n'].join('|');
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { material: o.material, geometries: [] });
    b.geometries.push(g);
  });
  for (const { material, geometries } of buckets.values()) {
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (merged) out.add(new THREE.Mesh(merged, material));
    else for (const g of geometries) out.add(new THREE.Mesh(g, material));
  }
  return out;
}

/** A float32, transform-baked copy (meshopt quantizes attributes to normalized ints). */
function bake(src: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const n = a.itemSize;
    const arr = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) {
      arr[i * n] = a.getX(i);
      if (n > 1) arr[i * n + 1] = a.getY(i);
      if (n > 2) arr[i * n + 2] = a.getZ(i);
      if (n > 3) arr[i * n + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  if (src.index) {
    const idx = Uint32Array.from(src.index.array as ArrayLike<number>);
    // A mirroring transform flips triangle winding; flip it back so faces stay outward.
    if (matrix.determinant() < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.applyMatrix4(matrix); // positions, normals and tangents
  return g;
}

/** A fresh copy of a model (geometry and materials shared), or null if not loaded. */
export function nasaModel(name: NasaModelName): THREE.Object3D | null {
  const src = loaded.get(name);
  return src ? src.clone(true) : null;
}

/**
 * Scale uniformly so the bounding box has the given height (or longest
 * horizontal side), then stand it on y = 0 centred on x/z. Wraps the objects
 * in one group so pieces that belong together (the LM's two stages) share a
 * single scale and keep their relative placement.
 */
export function fitTo(objects: THREE.Object3D[], size: { height: number } | { length: number }): THREE.Group {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  for (const o of objects) inner.add(o);
  group.add(inner);
  const box = new THREE.Box3().setFromObject(inner);
  const dims = box.getSize(new THREE.Vector3());
  const s = 'height' in size ? size.height / dims.y : size.length / Math.max(dims.x, dims.z);
  inner.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  return group;
}
