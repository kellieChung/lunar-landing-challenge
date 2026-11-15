// Base buildings and rovers for the first-person view, in the style of
// panorama3d/lander.ts: true size in metres, standing on y = 0. Rendering
// only. NASA's official models are used throughout: Perseverance for the
// rovers, the Apollo LM for the return rocket, both Habitat Demonstration
// Unit parts and the Space Shuttle External Tank for the plant, an InSight
// solar array for the solar tower and Perseverance's MMRTG for the power bank.
// Whether a solar panel glows comes from the physics, never from the renderer.

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
/** The HDU's second unit, the ice processor (its fins reach this high). */
const PROCESSOR_HEIGHT_M = 3.0;
/** The Shuttle External Tank, scaled down from 47 m to a base store. */
const TANK_LENGTH_M = 7.0;
/** Height of the saddles the tank lies on. */
const SADDLE_M = 0.35;
/** Walkway gap between the plant's parts. */
const PLANT_GAP_M = 0.8;
/** The fenced bin at the processor's far end (fractions of its footprint), where rovers tip their loads. */
const HOPPER_AT: [number, number] = [0.85, 0.4];
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
  readonly working: boolean;
  vent: THREE.Object3D; // top of the processing column (steam comes out here)
  hopper: THREE.Object3D; // where rovers tip their loads
}

/**
 * The ice plant, all from NASA parts: the Habitat Demonstration Unit as the
 * building, the HDU's second unit (a finned module on a deck with ramps) as
 * the processor rovers tip their ice into, and the Space Shuttle External
 * Tank, which really held liquid oxygen (forward) and hydrogen (aft), as the
 * store, lying on two saddles. A glow band along each side of the tank fills
 * as the products build up. NASA has no model of an ice plant; these are the
 * closest real hardware.
 */
export function buildPlant(): Plant {
  const g = new THREE.Group();
  const body = new THREE.Group(); // laid out from the building's centre; recentred below
  const hdu = nasaModel('hdu');
  const proc = nasaModel('hdu-processor');
  const et = nasaModel('fuel-tank');
  const nasa = hdu && proc && et;
  const building = nasa ? fitTo([hdu], { height: HDU_HEIGHT_M }) : fallbackBox(2.4, 1.6, 1.8, 0xd4a038);
  const processor = nasa ? fitTo([proc], { height: PROCESSOR_HEIGHT_M }) : fallbackBox(2.0, 1.6, 1.6, 0x8a8f98);
  const tank = nasa ? fitTo([et], { length: TANK_LENGTH_M }) : fallbackTank();

  // Layout: the processor beside the building (+x), and the low tank in
  // front of the tall building (+z, the side turned to the viewer), with a
  // walkway gap between each.
  body.add(building);
  const bb = box(building);
  processor.position.x = bb.max.x + PLANT_GAP_M - box(processor).min.x;
  body.add(processor);
  const pb = box(processor);
  const tb0 = box(tank);
  const r = (tb0.max.y - tb0.min.y) / 2;
  const tankLen = tb0.max.x - tb0.min.x;
  const tankX = (bb.min.x + bb.max.x) / 2;
  const tankZ = bb.max.z + PLANT_GAP_M + r;
  tank.position.set(tankX, SADDLE_M, tankZ);
  body.add(tank);
  const tankY = SADDLE_M + r; // the tank's axis
  for (const f of [-0.3, 0.3]) {
    body.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.45, tankY, r * 1.5), paint(0x8d939c, 0.8)), tankX + f * tankLen, tankY / 2, tankZ));
  }

  // Fill bands, on both sides of the tank at its widest: a dark track with a
  // glowing fill that grows from the tank's aft end (hydrogen) and from its
  // intertank (oxygen), where the real tanks were.
  const track = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6 });
  const fills: { mesh: THREE.Mesh; x0: number; len: number }[][] = [[], []]; // [h2, o2]
  BANDS.forEach(([a, b, color], k) => {
    const x0 = tankX + a * tankLen;
    const len = (b - a) * tankLen;
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 });
    for (const side of [-1, 1]) {
      const z = tankZ + side * (r + 0.02);
      body.add(at(new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.03), track), x0 + len / 2, tankY, z));
      const mesh = at(new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 0.04), glow), 0, tankY, z + side * 0.005);
      body.add(mesh);
      fills[k].push({ mesh, x0, len });
    }
  });
  const setFill = (k: number, f: number) => {
    for (const { mesh, x0, len } of fills[k]) {
      const l = Math.max(0.02, Math.min(1, f)) * len;
      mesh.scale.x = l;
      mesh.position.x = x0 + l / 2;
    }
  };

  // A status lamp on the processor's top, lit while the plant works; steam
  // comes out of the vent there, and rovers tip their loads into its fenced bin.
  const pc = pb.getCenter(new THREE.Vector3());
  const lamp = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.4, emissive: 0xff9a3a, emissiveIntensity: 0 });
  body.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 12), lamp), pc.x, pb.max.y + 0.08, pc.z));
  const vent = at(new THREE.Object3D(), pc.x, pb.max.y + 0.2, pc.z);
  const hopper = at(new THREE.Object3D(), pb.min.x + HOPPER_AT[0] * (pb.max.x - pb.min.x), 0.9,
    pb.min.z + HOPPER_AT[1] * (pb.max.z - pb.min.z));
  body.add(vent, hopper);

  // On a slope, the whole plant stands level on one foundation slab with
  // leveling jacks (the slab sits just below ground on the flat).
  const c = box(body).getCenter(new THREE.Vector3());
  body.position.set(-c.x, 0, -c.z); // stand (and turn) about the middle of the plant
  g.add(body);
  const all = box(g);
  const b = { x0: all.min.x - 0.3, x1: all.max.x + 0.3, z0: all.min.z - 0.3, z1: all.max.z + 0.3 };
  g.add(slab(b));
  const probes: [number, number][] = [[-c.x, -c.z], [pc.x - c.x, pc.z - c.z], [tankX - c.x, tankZ - c.z], [0, 0]];
  addFooting(g, { feet: rectFeet(b), probes, width: 0.22, maxRise: 8 });
  g.userData.faceViewer = true; // its +z side (the tank in front of the processor) toward the eye
  finish(g);
  setFill(0, 0);
  setFill(1, 0);
  let working = false;
  return {
    group: g,
    setWorking(on) { working = on; lamp.emissiveIntensity = on ? 1.4 : 0; },
    setLevels(h2, o2) { setFill(0, h2); setFill(1, o2); },
    get working() { return working; },
    vent,
    hopper,
  };
}

/** Where along the tank (fractions of its length from its centre; the nose is +x) each band runs, and its colour. */
const BANDS: [number, number, number][] = [
  [-0.457, 0.074, 0xf2f3f5], // hydrogen: the big aft tank
  [0.138, 0.319, 0x5aa9ff], // oxygen: the forward tank
];

function box(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

function fallbackBox(x: number, y: number, z: number, color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(x, y, z), paint(color, 0.4)), 0, y / 2, 0));
  return g;
}

function fallbackTank(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 5.6, 6, 20), paint(0xb5651d, 0.7));
  m.rotation.z = Math.PI / 2;
  g.add(at(m, 0, 0.7, 0));
  return g;
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

/** Jack positions round a rectangle, just inside its edge, no more than maxGap apart. */
function rectFeet(b: { x0: number; x1: number; z0: number; z1: number }, maxGap = 4): [number, number][] {
  const x0 = b.x0 + 0.2;
  const x1 = b.x1 - 0.2;
  const z0 = b.z0 + 0.2;
  const z1 = b.z1 - 0.2;
  const nx = Math.max(1, Math.ceil((x1 - x0) / maxGap));
  const nz = Math.max(1, Math.ceil((z1 - z0) / maxGap));
  const feet: [number, number][] = [];
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    feet.push([x, z0], [x, z1]);
  }
  for (let j = 1; j < nz; j++) {
    const z = z0 + ((z1 - z0) * j) / nz;
    feet.push([x0, z], [x1, z]);
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
  unitsPerM: number; // body position units per true metre (the NASA model sits in a scaled group)
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
  let unitsPerM = 1;
  if (nasa) {
    body.add(ascent);
    const fitted = fitTo([descent, body], { height: LM_HEIGHT_M });
    group.add(fitted);
    unitsPerM = 1 / fitted.children[0].scale.y;
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
  return { group, body, unitsPerM };
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
