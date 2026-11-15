// Base buildings and rovers for the first-person view, in the style of
// panorama3d/lander.ts: true size in metres, standing on y = 0. Rendering
// only. NASA's official models are used throughout: Perseverance for the
// rovers, the Apollo LM for the return rocket, the Habitat Demonstration Unit
// for the plant, an InSight solar array for the solar tower and Perseverance's
// MMRTG for the power bank; the rest (tanks, gauges, hopper) are illustrations. Whether a solar
// panel glows comes from the physics, never from the renderer.

import * as THREE from 'three';
import { addFooting, ring, tiltWithGround } from '../panorama3d/footing';
import { fitTo, nasaModel } from '../panorama3d/nasaModels';
import { buildSolarArray } from '../panorama3d/solarArray';

const metal = () => new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.3 });
const white = () => new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 0.55, metalness: 0.05 });
const paint = (color: number, roughness = 0.7) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });

/** Real heights / lengths (m) the NASA models are scaled to. */
const LM_HEIGHT_M = 7.0;
const HDU_HEIGHT_M = 6.0;
const ROVER_LENGTH_M = 3.0;
const TOWER_HUB_M = 3.2;
/** The MMRTG, scaled up from its real ~0.7 m to read as the base's power bank. */
const RTG_HEIGHT_M = 1.3;
/** Its tilt on the rover's back (rad), undone to stand it upright (set by eye). */
const RTG_TILT = 1.1;

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

export interface SolarTower {
  group: THREE.Group;
  setLit(lit: boolean): void; // from the physics
  face(azDeg: number): void;
}

/** A Sun-tracking array (NASA's InSight wing) on a lattice mast; the physics uses a 3 m mast height. */
export function buildSolarTower(): SolarTower {
  const a = buildSolarArray(TOWER_HUB_M);
  addFooting(a.group, { feet: ring(0.55, 3, Math.PI / 3), width: 0.12 });
  return { group: a.group, setLit: a.setLit, face: a.face };
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
  const building = hdu ? fitTo([hdu], { height: HDU_HEIGHT_M })
    : at(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.8), paint(0xd4a038, 0.3)), 0, 1.0, 0);
  g.add(building);

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

  // On a slope, the building and the processing gear each stand level on a
  // foundation slab with leveling jacks (the slab sits just below ground on the flat).
  const gear = new THREE.Group();
  gear.position.x = ox;
  for (const o of g.children.filter((c) => c !== building)) {
    o.position.x -= ox;
    gear.add(o);
  }
  g.add(gear);
  const bb = new THREE.Box3().setFromObject(building);
  const b = { x0: bb.min.x - 0.3, x1: bb.max.x + 0.3, z0: bb.min.z - 0.3, z1: bb.max.z + 0.3 };
  g.add(slab(b));
  addFooting(g, { feet: rectFeet(b), probes: [[0, 0]], width: 0.22, maxRise: 5 });
  const gb = { x0: -1.4, x1: 5.3, z0: -2.4, z1: 1.8 };
  gear.add(slab(gb));
  addFooting(g, { node: gear, feet: rectFeet(gb), probes: [[2.8, 0]], width: 0.16 });
  finish(g);
  setFill(h2Fill, 0);
  setFill(o2Fill, 0);
  return {
    group: g,
    setWorking(on) { glow.emissiveIntensity = on ? 1.2 : 0; },
    setLevels(h2, o2) { setFill(h2Fill, h2); setFill(o2Fill, o2); },
  };
}

/**
 * Power unit: the finned MMRTG lifted out of NASA's Perseverance model, set
 * level on a low cradle. Falls back to a simple box.
 */
export function buildBattery(): THREE.Group {
  const rtg = nasaModel('rtg');
  if (!rtg) return buildFallbackBattery();
  const g = new THREE.Group();
  // On the rover it is mounted tilted up at the back; level it out.
  rtg.rotation.x = RTG_TILT;
  const unit = fitTo([rtg], { height: RTG_HEIGHT_M });
  unit.position.y = 0.02; // its rover mounting struts sink into the cradle
  g.add(unit);
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.3), paint(0x9aa1ab, 0.6)), 0, 0.15, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.05, 1.36), metal()), 0, 0.3, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x4fd18b, emissive: 0x4fd18b, emissiveIntensity: 0.8 })), 0, 0.16, 0.66));
  addFooting(g, { feet: [[-0.65, -0.55], [0.65, -0.55], [-0.65, 0.55], [0.65, 0.55]], width: 0.1 });
  return finish(g);
}

function buildFallbackBattery(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), paint(0x3d4656, 0.55)), 0, 0.6, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.1), metal()), 0, 1.09, 0));
  return finish(g);
}

/** A foundation slab over a rectangle, its top at y = 0 (so it is out of sight on flat ground). */
function slab(b: { x0: number; x1: number; z0: number; z1: number }): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, 0.25, b.z1 - b.z0), paint(0x6b7079, 0.9));
  return at(m, (b.x0 + b.x1) / 2, -0.12, (b.z0 + b.z1) / 2);
}

/** Jack positions round a rectangle: the corners, plus mid-points on sides longer than 4 m. */
function rectFeet(b: { x0: number; x1: number; z0: number; z1: number }): [number, number][] {
  const xs = b.x1 - b.x0 > 4 ? [b.x0, (b.x0 + b.x1) / 2, b.x1] : [b.x0, b.x1];
  const zs = b.z1 - b.z0 > 4 ? [b.z0, (b.z0 + b.z1) / 2, b.z1] : [b.z0, b.z1];
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const feet: [number, number][] = [];
  for (const x of xs) {
    for (const z of zs) {
      if (x === cx && z === cz) continue; // only round the edge
      feet.push([x + Math.sign(cx - x) * 0.2, z + Math.sign(cz - z) * 0.2]); // just inside the slab
    }
  }
  return feet;
}

/** NASA's Mars 2020 Perseverance rover, standing in as the base's regolith hauler. */
export function buildRover(): THREE.Group {
  const rover = nasaModel('perseverance');
  if (!rover) return buildFallbackRover();
  rover.rotation.y = Math.PI / 2; // its long axis is z; drive along +x like the old rover
  const g = finish(fitTo([rover], { length: ROVER_LENGTH_M }));
  tiltWithGround(g, 1.1, 1.1); // its wheels, about 1.1 m out each way
  return g;
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
  tiltWithGround(g, 0.5, 0.6);
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
export function buildRocket(withBerm: boolean): Rocket {
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
  let berm: { node: THREE.Group; feet: [number, number][] } | null = null;
  if (withBerm) {
    // A horseshoe of piled regolith between the pad and the base.
    const r = nasa ? 8.5 : 4.2;
    const wall = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.17, 8, 32, Math.PI * 1.4), paint(0x8d9097, 0.95));
    wall.rotation.x = Math.PI / 2;
    wall.rotation.z = Math.PI * 0.3;
    wall.scale.set(1, 1, 0.9);
    const pile = new THREE.Group();
    pile.add(at(wall, 0, 0.1, 0));
    group.add(pile);
    // Piled regolith follows the ground down, rather than standing on the pad's jacks.
    berm = { node: pile, feet: ring(r, 6, Math.PI * 0.3) };
  }
  // On a slope the pad stays level on leveling jacks round its rim.
  addFooting(group, { feet: ring(padR - 0.4, nasa ? 8 : 5, Math.PI / 8), probes: [[0, 0]], width: nasa ? 0.24 : 0.12, maxRise: 7 });
  if (berm) addFooting(group, { ...berm, sink: true });
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
