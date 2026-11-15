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

export type NasaModelName = 'lm-descent' | 'lm-ascent' | 'perseverance' | 'hdu';
const NAMES: NasaModelName[] = ['lm-descent', 'lm-ascent', 'perseverance', 'hdu'];

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
    prepare(gltf.scene);
    loaded.set(name, gltf.scene);
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
