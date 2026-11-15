// Low-poly base buildings and rovers for the first-person view, in the style
// of panorama3d/lander.ts: true size in metres, standing on y = 0. Rendering
// only. Shapes are illustrations (the designs are hypothetical); whether a
// solar panel glows comes from the physics, never from the renderer.

import * as THREE from 'three';

const metal = () => new THREE.MeshStandardMaterial({ color: 0xd0d5dd, roughness: 0.4, metalness: 0.7, flatShading: true });
const white = () => new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.6, metalness: 0.1, flatShading: true });
const paint = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, flatShading: true });

const PANEL_LIT = 0xffc845;
const PANEL_DARK = 0x1a2238;

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

/** A Sun-tracking panel on a short mast (the physics uses a 3 m mast height). */
export function buildSolarTower(): SolarTower {
  const group = new THREE.Group();
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.4, 8), metal()), 0, 0.2, 0));
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6), metal()), 0, 1.5, 0));
  const panelMat = new THREE.MeshStandardMaterial({
    color: PANEL_DARK, emissive: PANEL_DARK, emissiveIntensity: 0.4, roughness: 0.4, flatShading: true,
  });
  const head = new THREE.Group();
  head.position.y = 3.2;
  head.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.4, 0.06), panelMat));
  head.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.1), metal()), 0, 0, -0.06));
  group.add(head);
  finish(group);
  return {
    group,
    setLit(lit) {
      panelMat.color.setHex(lit ? PANEL_LIT : PANEL_DARK);
      panelMat.emissive.setHex(lit ? PANEL_LIT : PANEL_DARK);
      panelMat.emissiveIntensity = lit ? 0.9 : 0.4;
    },
    face(azDeg) {
      head.rotation.y = Math.PI - (azDeg * Math.PI) / 180;
    },
  };
}

export interface Plant {
  group: THREE.Group;
  /** The oven glows while the plant is working (rendering only). */
  setWorking(on: boolean): void;
  /** Fill gauges beside the tanks, 0..1 of the rocket's needs. */
  setLevels(h2: number, o2: number): void;
}

/** Processing plant: an oven box, a chimney-like column, two tanks with fill gauges (hydrogen is the big one). */
export function buildPlant(): Plant {
  const g = new THREE.Group();
  const ovenMat = new THREE.MeshStandardMaterial({ color: 0xd4a038, roughness: 0.3, metalness: 0.85, flatShading: true, emissive: 0xff7a1a, emissiveIntensity: 0 });
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.8), ovenMat), 0, 1.0, 0));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.6, 8), metal()), -0.7, 2.4, 0.3));
  // Hopper where rovers tip their regolith.
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.35, 0.9, 4), metal());
  g.add(at(hopper, 0.5, 2.25, 0));
  // Tanks: hydrogen is very light, so the same mass needs a much bigger tank.
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), white()), 2.8, 1.3, 0));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), paint(0x8fb7e8)), 4.4, 0.9, 0.4));
  for (const x of [2.8, 4.4]) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 6), metal()), x, 0.15, x === 4.4 ? 0.4 : 0));
  // Fill gauges: a glass tube with a glowing column that rises as the tank fills.
  const gauge = (x: number, color: number) => {
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 10),
      new THREE.MeshStandardMaterial({ color: 0x9fb0c8, transparent: true, opacity: 0.25, roughness: 0.1 }));
    g.add(at(glass, x, 1.2, 1.3));
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 10),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
    fill.position.set(x, 0, 1.3);
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
    setWorking(on) { ovenMat.emissiveIntensity = on ? 0.9 : 0; },
    setLevels(h2, o2) { setFill(h2Fill, h2); setFill(o2Fill, o2); },
  };
}

export function buildBattery(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), paint(0x3d4656)), 0, 0.6, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.1), paint(0x4fd18b)), 0, 1.1, 0));
  for (const x of [-0.6, 0.6]) g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.9), metal()), x, 0.15, 0));
  return finish(g);
}

export function buildRover(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.0), white()), 0, 0.75, 0));
  // Digging drum at the front, a dump bed on top.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.0, 8), metal());
  drum.rotation.x = Math.PI / 2;
  g.add(at(drum, 1.05, 0.45, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), paint(0x8a8f98)), -0.2, 1.15, 0));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), metal()), -0.6, 1.45, 0.35));
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

/** The return rocket on its pad, with the regolith blast wall if it has been built. */
export function buildRocket(berm: boolean): Rocket {
  const group = new THREE.Group();
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.1, 16), paint(0x6b7079)), 0, 0.05, 0));
  const body = new THREE.Group();
  body.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 2.6, 10), white()), 0, 1.9, 0));
  body.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 10), paint(0xd9534f)), 0, 3.7, 0));
  body.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.6, 10, 1, true), metal()), 0, 0.4, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5), metal());
    leg.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
    body.add(at(leg, Math.sin(a) * 0.9, 0.5, Math.cos(a) * 0.9));
  }
  group.add(body);
  if (berm) {
    // A horseshoe of piled regolith between the pad and the base.
    const wall = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.9, 5, 14, Math.PI * 1.4), paint(0x8d9097));
    wall.rotation.x = Math.PI / 2;
    wall.rotation.z = Math.PI * 0.3;
    wall.scale.set(1, 1, 0.9);
    group.add(at(wall, 0, 0.1, 0));
  }
  finish(group);
  return { group, body };
}
