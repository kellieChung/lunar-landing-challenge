// A Sun-tracking solar array on a mast: one wing of NASA's InSight lander
// (a 2.2 m UltraFlex array, lifted out of NASA's model by
// scripts/build-nasa-models.mjs). Used beside the lander and as the base's
// solar tower. Whether it glows comes from the physics, never the renderer.

import * as THREE from 'three';
import { fitTo, nasaModel } from './nasaModels';

const RAD = Math.PI / 180;
const ARRAY_DIAMETER_M = 2.2;
const LIT_GLOW = 0xffb54a;
const PANEL_LIT = 0xffc845;
const PANEL_DARK = 0x1a2238;

export interface SolarArray {
  group: THREE.Group;
  setLit(lit: boolean): void;
  /** Turn the array's face toward an azimuth (deg), in world terms. */
  face(azDeg: number): void;
}

/** Built at true size in metres, standing on y = 0; the array's centre is at hubM. */
export function buildSolarArray(hubM: number): SolarArray {
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.4, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.6, metalness: 0.2 });

  // Footing and a three-legged lattice mast, tapering to a gimbal under the hub.
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.22, 20), dark), 0, 0.11, 0));
  const top = hubM - 1.25; // the gimbal sits just under the array's lower edge
  const legs = [0, 1, 2].map((i) => (i * 2 * Math.PI) / 3);
  const rAt = (y: number) => 0.38 - 0.28 * Math.min(1, y / top);
  const p = (a: number, y: number) => new THREE.Vector3(Math.sin(a) * rAt(y), y, Math.cos(a) * rAt(y));
  for (const a of legs) group.add(strut(p(a, 0.22), p(a, top), 0.028, frame));
  const bays = Math.max(2, Math.round((top - 0.22) / 0.6));
  for (let b = 0; b < bays; b++) {
    const y0 = 0.22 + ((top - 0.22) * b) / bays;
    const y1 = 0.22 + ((top - 0.22) * (b + 1)) / bays;
    for (let i = 0; i < 3; i++) {
      group.add(strut(p(legs[i], y0), p(legs[(i + 1) % 3], y1), 0.011, frame));
      group.add(strut(p(legs[i], y1), p(legs[(i + 1) % 3], y1), 0.011, frame));
    }
  }

  // The head turns about the vertical; the array hangs from it on a short yoke.
  const head = new THREE.Group();
  head.position.y = top;
  head.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 16), dark), 0, 0.1, 0));
  // (the yoke runs up behind the array, which faces +z)
  head.add(strut(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 0.2, -0.34), 0.04, frame));
  head.add(strut(new THREE.Vector3(0, 0.2, -0.34), new THREE.Vector3(0, hubM - top, -0.34), 0.04, frame));
  group.add(head);

  const wing = nasaModel('solar-array');
  let setLit: (lit: boolean) => void;
  if (wing) {
    // In NASA's model the wing lies flat, cells up (+y); stand it up so the cells face +z.
    wing.rotation.x = Math.PI / 2;
    const fitted = fitTo([wing], { length: ARRAY_DIAMETER_M });
    const box = new THREE.Box3().setFromObject(fitted);
    fitted.position.set(0, hubM - top - (box.max.y - box.min.y) / 2, 0);
    head.add(fitted);
    // Own copies of the materials, so each array shows its own lit state.
    const mats: THREE.MeshStandardMaterial[] = [];
    fitted.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
      const m = o.material.clone();
      m.emissiveMap = m.map;
      o.material = m;
      mats.push(m);
    });
    setLit = (lit) => {
      for (const m of mats) {
        m.emissive.setHex(lit ? LIT_GLOW : 0x000000);
        m.emissiveIntensity = lit ? 0.85 : 0;
        m.color.setScalar(lit ? 1 : 0.55);
      }
    };
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: PANEL_DARK, emissive: PANEL_DARK, emissiveIntensity: 0.4, roughness: 0.4 });
    head.add(at(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.04), mat), 0, hubM - top, 0));
    setLit = (lit) => {
      mat.color.setHex(lit ? PANEL_LIT : PANEL_DARK);
      mat.emissive.setHex(lit ? PANEL_LIT : PANEL_DARK);
      mat.emissiveIntensity = lit ? 0.9 : 0.4;
    };
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false; // a shadow must never contradict the physics-driven glow
    }
  });
  setLit(false);

  return {
    group,
    setLit,
    face(azDeg) {
      // Face +z toward the azimuth, undoing however the whole group is turned.
      let turn = 0;
      for (let o: THREE.Object3D | null = group; o; o = o.parent) turn += o.rotation.y;
      head.rotation.y = Math.PI - azDeg * RAD - turn;
    },
  };
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}
