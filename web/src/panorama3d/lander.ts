// The lander standing in front of the viewer: NASA's Apollo LM. Its solar
// panel shows the physics result (lit or dark); it is never lit "by the renderer".

import * as THREE from 'three';
import { addFooting, ring } from './footing';
import { heightOnMesh, type Heightmap } from './heightmap';
import { fitTo, nasaModel } from './nasaModels';
import { buildSolarArray, type SolarArray } from './solarArray';

const RAD = Math.PI / 180;

const PANEL_LIT = 0xffc845;
const PANEL_DARK = 0x1a2238;

export interface Lander {
  group: THREE.Group;
  setPanelLit(lit: boolean): void;
  /** Turn the panels to face an azimuth (deg). */
  facePanels(azDeg: number): void;
  /** Things that stand on the ground (solar mast, jacks, contact shadow): hidden while it flies. */
  groundParts(): THREE.Object3D[];
}

/** Real Apollo LM height, legs extended (m). */
const LM_HEIGHT_M = 7.0;
/** The sun-tracking array stands on its own mast beside the LM, clear of its footpads (~4.5 m out). */
const PANEL_MAST_X = 6.4;
const PANEL_HUB_M = 3.4;
/** The LM's footpads: on its ±x and ±z axes, this far out in NASA's model (its own units). */
const LM_FOOTPAD_R_RAW = 2.86;

/**
 * NASA's Apollo Lunar Module at true size in metres, standing on y = 0, with a
 * sun-tracking solar array (from NASA's InSight) on a mast beside it. Falls back to a simple shape if the
 * NASA models are not loaded.
 */
export function buildLander(): Lander {
  const group = new THREE.Group();
  const descent = nasaModel('lm-descent');
  const ascent = nasaModel('lm-ascent');
  const nasa = descent && ascent;
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.4, metalness: 0.3 });

  // The physics-driven solar panel: NASA's InSight array on its own mast
  // beside the LM (or the old two flat panels on the simple fallback lander).
  let array: SolarArray | null = null;
  const panelMat = new THREE.MeshStandardMaterial({
    color: PANEL_DARK, emissive: PANEL_DARK, emissiveIntensity: 0.4, roughness: 0.4, flatShading: true,
  });
  const panels = new THREE.Group();
  let footR = 1.45;
  if (nasa) {
    const lm = fitTo([descent, ascent], { height: LM_HEIGHT_M });
    group.add(lm);
    footR = LM_FOOTPAD_R_RAW * lm.children[0].scale.x;
    array = buildSolarArray(PANEL_HUB_M);
    array.group.position.x = PANEL_MAST_X;
    group.add(array.group);
  } else {
    buildFallbackBody(group, metal);
    panels.position.y = 2.6;
    group.add(panels);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.04), panelMat);
      p.position.set(side * 0.8, 0, 0);
      panels.add(p);
    }
  }

  // What flies: the LM (with its own panels on the fallback). Everything added after stays on the ground.
  const flies = new Set(group.children.filter((o) => o !== array?.group));

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false; // a shadow must never contradict the physics-driven panel
    }
  });

  // Soft dark patch under the lander so it reads as standing on the ground
  // even when there is no sunlight to cast a real shadow.
  const contact = new THREE.Mesh(new THREE.CircleGeometry(nasa ? 5.2 : 2.2, 32), new THREE.MeshBasicMaterial({
    map: contactTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.03;
  contact.renderOrder = 1;
  contact.castShadow = false;
  group.add(contact);

  // On a slope the LM stays level on leveling jacks under its footpads (and the
  // mast on its own), instead of floating on the downhill side.
  addFooting(group, {
    feet: ring(footR, 4, nasa ? 0 : 45 * RAD),
    probes: ring(footR * 0.5, 4, 45 * RAD),
    width: nasa ? 0.2 : 0.1,
    hideWhenRaised: [contact],
  });
  if (array) addFooting(group, { node: array.group, feet: ring(0.55, 3, Math.PI / 3), width: 0.12 });

  return {
    group,
    groundParts: () => group.children.filter((o) => !flies.has(o)),
    setPanelLit(lit) {
      array?.setLit(lit);
      panelMat.color.setHex(lit ? PANEL_LIT : PANEL_DARK);
      panelMat.emissive.setHex(lit ? PANEL_LIT : PANEL_DARK);
      panelMat.emissiveIntensity = lit ? 0.9 : 0.4;
    },
    facePanels(azDeg) {
      array?.face(azDeg);
      // Panel faces +z by default; point its face toward the azimuth (in world
      // terms, so undo however the lander itself is turned).
      panels.rotation.y = Math.PI - azDeg * RAD - group.rotation.y;
    },
  };
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

/** The simple low-poly lander, used only if the NASA models failed to load. */
function buildFallbackBody(group: THREE.Group, metal: THREE.Material): void {
  const foil = new THREE.MeshStandardMaterial({ color: 0xd4a038, roughness: 0.28, metalness: 0.35, flatShading: true });
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 1.2, 8), foil), 0, 1.3, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i * 90 + 45) * RAD;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 5), metal);
    leg.position.set(Math.sin(a) * 1.15, 0.6, Math.cos(a) * 1.15);
    leg.rotation.set(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45);
    group.add(leg, at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 6), metal), Math.sin(a) * 1.45, 0.03, Math.cos(a) * 1.45));
  }
  group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5), metal), 0, 2.45, 0));
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
