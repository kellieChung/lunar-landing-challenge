// A simple low-poly lander standing in front of the viewer. Its solar panel
// shows the physics result (lit or dark); it is never lit "by the renderer".

import * as THREE from 'three';
import { heightOnMesh, type Heightmap } from './heightmap';

const RAD = Math.PI / 180;

const PANEL_LIT = 0xffc845;
const PANEL_DARK = 0x1a2238;

export interface Lander {
  group: THREE.Group;
  setPanelLit(lit: boolean): void;
  /** Turn the panels to face an azimuth (deg). */
  facePanels(azDeg: number): void;
}

/** Built at true size in metres, standing on y = 0, about 3 m tall. */
export function buildLander(): Lander {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xd0d5dd, roughness: 0.35, metalness: 0.8, flatShading: true });
  const foil = new THREE.MeshStandardMaterial({ color: 0xd4a038, roughness: 0.28, metalness: 0.85, flatShading: true });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 1.2, 8), foil);
  body.position.y = 1.3;
  group.add(body);

  for (let i = 0; i < 4; i++) {
    const a = (i * 90 + 45) * RAD;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 5), metal);
    leg.position.set(Math.sin(a) * 1.15, 0.6, Math.cos(a) * 1.15);
    leg.rotation.set(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 6), metal);
    pad.position.set(Math.sin(a) * 1.45, 0.03, Math.cos(a) * 1.45);
    group.add(leg, pad);
  }

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5), metal);
  mast.position.y = 2.45;
  group.add(mast);

  const panelMat = new THREE.MeshStandardMaterial({
    color: PANEL_DARK, emissive: PANEL_DARK, emissiveIntensity: 0.4, roughness: 0.4, flatShading: true,
  });
  const panels = new THREE.Group();
  panels.position.y = 2.6;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.04), panelMat);
    p.position.set(side * 0.8, 0, 0);
    panels.add(p);
  }
  group.add(panels);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false; // a shadow must never contradict the physics-driven panel
    }
  });

  // Soft dark patch under the lander so it reads as standing on the ground
  // even when there is no sunlight to cast a real shadow.
  const contact = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({
    map: contactTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.03;
  contact.renderOrder = 1;
  group.add(contact);

  return {
    group,
    setPanelLit(lit) {
      panelMat.color.setHex(lit ? PANEL_LIT : PANEL_DARK);
      panelMat.emissive.setHex(lit ? PANEL_LIT : PANEL_DARK);
      panelMat.emissiveIntensity = lit ? 0.9 : 0.4;
    },
    facePanels(azDeg) {
      // Panel faces +z by default; point its face toward the azimuth.
      panels.rotation.y = Math.PI - azDeg * RAD;
    },
  };
}

function contactTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/**
 * Where to stand the lander so it looks the same at every stretch k: scaled
 * uniformly by k and placed k * d0 metres away (similar triangles), on the
 * stretched ground there. Eye at the origin; three.js axes.
 */
export function landerPlacement(t: Heightmap | null, mastM: number, k: number, azDeg: number, d0 = 30): {
  pos: [number, number, number]; scale: number;
} {
  const d = k * d0;
  const x = Math.sin(azDeg * RAD) * d;
  const north = Math.cos(azDeg * RAD) * d;
  const zGround = t ? heightOnMesh(t, x, north) : NaN; // on the drawn triangles, so the feet touch
  const ground = Number.isFinite(zGround) ? zGround : 0;
  return { pos: [x, k * (ground - mastM), -north], scale: k };
}
