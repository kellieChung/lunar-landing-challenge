// Base buildings and rovers for the first-person view, in the style of
// panorama3d/lander.ts: true size in metres, standing on y = 0. Rendering
// only. Where NASA publishes an official model it is used (Perseverance for
// the rovers, the Apollo LM for the return rocket, the Habitat Demonstration
// Unit for the plant); otherwise the shapes are illustrations. Whether a solar
// panel glows comes from the physics, never from the renderer.

import * as THREE from 'three';
import { fitTo, nasaModel } from '../panorama3d/nasaModels';

const metal = () => new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.3 });
const white = () => new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 0.55, metalness: 0.05 });
const paint = (color: number, roughness = 0.7) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });

const PANEL_LIT = 0xffc845;
const PANEL_DARK = 0x1a2238;

/** Real heights / lengths (m) the NASA models are scaled to. */
const LM_HEIGHT_M = 7.0;
const HDU_HEIGHT_M = 6.0;
const ROVER_LENGTH_M = 3.0;

function finish(group: THREE.Group): THREE.Group {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  return group;
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

/** A thin strut from a to b. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

let cellTexture: THREE.Texture | null = null;
/** Solar-cell grid: light cells with dark gaps, so the lit/dark tint reads through. */
function solarCells(): THREE.Texture {
  if (cellTexture) return cellTexture;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2f3a';
  g.fillRect(0, 0, n, n);
  const cells = 8;
  const step = n / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const shade = 225 + ((i * 7 + j * 13) % 5) * 6;
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(i * step + 1.5, j * step + 1.5, step - 3, step - 3);
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.35)'; // busbars
  for (let j = 0; j < cells; j++) g.fillRect(0, j * step + step / 2 - 0.5, n, 1);
  cellTexture = new THREE.CanvasTexture(c);
  cellTexture.colorSpace = THREE.SRGBColorSpace;
  cellTexture.wrapS = cellTexture.wrapT = THREE.RepeatWrapping;
  cellTexture.repeat.set(1, 2);
  return cellTexture;
}

function panelMaterial(): THREE.MeshStandardMaterial {
  const map = solarCells();
  return new THREE.MeshStandardMaterial({
    color: PANEL_DARK, map, emissive: PANEL_DARK, emissiveMap: map, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.1,
  });
}

function setPanel(mat: THREE.MeshStandardMaterial, lit: boolean): void {
  mat.color.setHex(lit ? PANEL_LIT : PANEL_DARK);
  mat.emissive.setHex(lit ? PANEL_LIT : PANEL_DARK);
  mat.emissiveIntensity = lit ? 0.9 : 0.4;
}

export interface SolarTower {
  group: THREE.Group;
  setLit(lit: boolean): void; // from the physics
  face(azDeg: number): void;
}

/** A Sun-tracking panel on a lattice mast (the physics uses a 3 m mast height). */
export function buildSolarTower(): SolarTower {
  const group = new THREE.Group();
  const frame = metal();
  // Ballast footing and a three-legged lattice mast with cross braces.
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.3, 16), paint(0x6b7079)), 0, 0.15, 0));
  const legs = [0, 1, 2].map((i) => (i * 2 * Math.PI) / 3);
  const foot = (a: number, y: number, r: number) => new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
  const rAt = (y: number) => 0.42 - 0.3 * (y / 2.9);
  for (const a of legs) group.add(strut(foot(a, 0.3, rAt(0.3)), foot(a, 2.9, rAt(2.9)), 0.03, frame));
  for (let y = 0.3; y < 2.9; y += 0.65) {
    for (let i = 0; i < 3; i++) {
      const a0 = legs[i];
      const a1 = legs[(i + 1) % 3];
      group.add(strut(foot(a0, y, rAt(y)), foot(a1, y + 0.65, rAt(y + 0.65)), 0.012, frame));
      group.add(strut(foot(a0, y, rAt(y)), foot(a1, y, rAt(y)), 0.012, frame));
    }
  }
  // Gimbal head and the panel in a thin frame.
  const head = new THREE.Group();
  head.position.y = 3.2;
  head.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), frame), 0, -0.25, 0));
  const panelMat = panelMaterial();
  head.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.4, 0.04), panelMat));
  const rail = paint(0x9aa1ab, 0.4);
  for (const x of [-0.82, 0.82]) head.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.5, 0.08), rail), x, 0, -0.02));
  for (const y of [-1.72, 0, 1.72]) head.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.08), rail), 0, y, -0.02));
  group.add(head);
  finish(group);
  return {
    group,
    setLit(lit) { setPanel(panelMat, lit); },
    face(azDeg) {
      head.rotation.y = Math.PI - (azDeg * Math.PI) / 180;
    },
  };
}

export interface Plant {
  group: THREE.Group;
  /** The processing unit glows while the plant is working (rendering only). */
  setWorking(on: boolean): void;
  /** Fill gauges beside the tanks, 0..1 of the rocket's needs. */
  setLevels(h2: number, o2: number): void;
}

/**
 * Processing plant: NASA's Habitat Demonstration Unit as the building, with a
 * processing column and hopper, and two tanks with fill gauges beside it
 * (hydrogen is the big one).
 */
export function buildPlant(): Plant {
  const g = new THREE.Group();
  const hdu = nasaModel('hdu');
  // Layout: the building at the origin, the processing gear to its +x side.
  const ox = hdu ? 6.4 : 0;
  if (hdu) g.add(fitTo([hdu], { height: HDU_HEIGHT_M }));
  else g.add(at(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.8), paint(0xd4a038, 0.3)), 0, 1.0, 0));

  // Processing column with a glowing vent ring, and the hopper rovers tip regolith into.
  const glow = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.4, emissive: 0xff7a1a, emissiveIntensity: 0 });
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 2.6, 16), white()), ox - 0.7, 1.3, -1.6));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.18, 16), glow), ox - 0.7, 2.2, -1.6));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.3, 12), glow), ox - 0.7, 2.75, -1.6));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.35, 0.9, 4), metal()), ox + 0.6, 2.25, -1.6));
  for (const x of [0.25, 0.95]) {
    for (const z of [-1.25, -1.95]) g.add(strut(new THREE.Vector3(ox + x, 0, z), new THREE.Vector3(ox + x, 1.85, z), 0.04, metal()));
  }
  // Tanks: hydrogen is very light, so the same mass needs a much bigger tank.
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16), white()), ox + 2.8, 1.3, 0));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), paint(0x8fb7e8, 0.45)), ox + 4.4, 0.9, 0.4));
  for (const x of [2.8, 4.4]) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 16), metal()), ox + x, 0.15, x === 4.4 ? 0.4 : 0));
  // Fill gauges: a glass tube with a glowing column that rises as the tank fills.
  const gauge = (x: number, color: number) => {
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 16),
      new THREE.MeshStandardMaterial({ color: 0x9fb0c8, transparent: true, opacity: 0.25, roughness: 0.1 }));
    g.add(at(glass, ox + x, 1.2, 1.3));
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 16),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
    fill.position.set(ox + x, 0, 1.3);
    g.add(fill);
    return fill;
  };
  const h2Fill = gauge(2.8, 0xf2f3f5);
  const o2Fill = gauge(4.4, 0x5aa9ff);
  const setFill = (m: THREE.Mesh, f: number) => {
    const h = Math.max(0.02, Math.min(1, f)) * 2.3;
    m.scale.y = h;
    m.position.y = 0.05 + h / 2;
  };
  finish(g);
  setFill(h2Fill, 0);
  setFill(o2Fill, 0);
  return {
    group: g,
    setWorking(on) { glow.emissiveIntensity = on ? 1.2 : 0; },
    setLevels(h2, o2) { setFill(h2Fill, h2); setFill(o2Fill, o2); },
  };
}

/** Battery bank: a ribbed radiator box with a status strip. */
export function buildBattery(): THREE.Group {
  const g = new THREE.Group();
  const body = paint(0x3d4656, 0.55);
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), body), 0, 0.6, 0));
  // Radiator fins along both long sides.
  const fin = paint(0xb8bec7, 0.4);
  for (let i = 0; i < 9; i++) {
    for (const z of [-0.56, 0.56]) g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.78, 0.12), fin), -0.68 + i * 0.17, 0.6, z));
  }
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.1), metal()), 0, 1.09, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x4fd18b, emissive: 0x4fd18b, emissiveIntensity: 0.7 })), 0, 1.15, 0.38));
  for (const x of [-0.6, 0.6]) g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.95), metal()), x, 0.08, 0));
  return finish(g);
}

/** NASA's Mars 2020 Perseverance rover, standing in as the base's regolith hauler. */
export function buildRover(): THREE.Group {
  const rover = nasaModel('perseverance');
  if (!rover) return buildFallbackRover();
  rover.rotation.y = Math.PI / 2; // its long axis is z; drive along +x like the old rover
  return finish(fitTo([rover], { length: ROVER_LENGTH_M }));
}

function buildFallbackRover(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.0), white()), 0, 0.75, 0));
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.0, 8), metal());
  drum.rotation.x = Math.PI / 2;
  g.add(at(drum, 1.05, 0.45, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), paint(0x8a8f98)), -0.2, 1.15, 0));
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.6, 0.6]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10), paint(0x2a2d33));
      wheel.rotation.x = Math.PI / 2;
      g.add(at(wheel, x, 0.32, z));
    }
  }
  return finish(g);
}

export interface Rocket {
  group: THREE.Group;
  body: THREE.Group; // the part that lifts off
}

/**
 * The return rocket on its pad: NASA's Apollo LM, whose ascent stage lifts off
 * and leaves the descent stage behind, with the regolith blast wall if built.
 */
export function buildRocket(berm: boolean): Rocket {
  const group = new THREE.Group();
  const descent = nasaModel('lm-descent');
  const ascent = nasaModel('lm-ascent');
  const nasa = descent && ascent;
  const padR = nasa ? 6 : 2.2;
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(padR, padR, 0.1, 48), paint(0x6b7079, 0.9)), 0, 0.05, 0));
  const body = new THREE.Group();
  if (nasa) {
    body.add(ascent);
    group.add(fitTo([descent, body], { height: LM_HEIGHT_M }));
  } else {
    buildFallbackRocketBody(body);
    group.add(body);
  }
  if (berm) {
    // A horseshoe of piled regolith between the pad and the base.
    const r = nasa ? 8.5 : 4.2;
    const wall = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.17, 8, 32, Math.PI * 1.4), paint(0x8d9097, 0.95));
    wall.rotation.x = Math.PI / 2;
    wall.rotation.z = Math.PI * 0.3;
    wall.scale.set(1, 1, 0.9);
    group.add(at(wall, 0, 0.1, 0));
  }
  finish(group);
  return { group, body };
}

function buildFallbackRocketBody(body: THREE.Group): void {
  body.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 2.6, 10), white()), 0, 1.9, 0));
  body.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 10), paint(0xd9534f)), 0, 3.7, 0));
  body.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.6, 10, 1, true), metal()), 0, 0.4, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5), metal());
    leg.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
    body.add(at(leg, Math.sin(a) * 0.9, 0.5, Math.cos(a) * 0.9));
  }
}
