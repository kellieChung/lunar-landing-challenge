// Standing props on sloped ground. A prop is placed at the ground height under
// its centre, so on a slope one side floats. Two remedies, chosen per prop:
//
// - Structures (the lander, buildings, the rocket pad) stay level, as built
//   things are, and stand on leveling jacks: each foot gets a telescoping
//   column down to the ground, braced when it is long.
// - Vehicles (rovers) tilt with the ground under their wheels.
//
// Rendering only; nothing here changes what the physics sees.

import * as THREE from 'three';

/**
 * Ground height (m, in the prop's own frame, relative to its origin) at a
 * point (u, v) of the prop's x/z plane. Turning about y is accounted for; tilt is not.
 */
export type GroundSampler = (u: number, v: number) => number;

/** By default jacks never lift a unit more than this above its lowest foot; beyond it the uphill side sinks in. */
const MAX_RISE_M = 3;
/** Shorter gaps than this are left alone (bumps the feet can sit in). */
const MIN_JACK_M = 0.06;
/** Above this, a jack gets a knee brace back toward the unit's centre. */
const BRACE_FROM_M = 0.6;
/** Rovers don't tilt past this (rad). */
const MAX_TILT = 0.6;

const jackMetal = new THREE.MeshStandardMaterial({ color: 0xaeb4bd, roughness: 0.45, metalness: 0.3 });
const jackDark = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.7, metalness: 0.15 });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitRod = new THREE.CylinderGeometry(1, 1, 1, 6);
const padGeo = new THREE.CylinderGeometry(1, 1.15, 1, 12);

interface Jack {
  x: number; // in the unit node's frame
  z: number;
  group: THREE.Group;
  column: THREE.Mesh;
  pad: THREE.Mesh;
  brace: THREE.Mesh;
  /** Unit vector (x, z) from the foot toward the unit's centre, for the brace. */
  inward: [number, number];
}

interface Unit {
  node: THREE.Object3D | null; // null: the prop's root itself
  jacks: Jack[];
  probes: [number, number][]; // extra ground checks (no jack) so nothing between the feet is buried
  hideWhenRaised: THREE.Object3D[];
  maxRise: number;
  sink: boolean;
}

interface Tilt { halfX: number; halfZ: number }

export interface FootingOptions {
  /** Shift this child (positioned at y = 0 in the root) instead of the root itself. */
  node?: THREE.Object3D;
  /** Where the unit touches the ground, in the node's x/z. */
  feet: [number, number][];
  /** Extra points (node x/z) the unit must clear, without a jack. */
  probes?: [number, number][];
  /** Column width (m); the pad is about twice this. */
  width?: number;
  /** Ground-level dressing (contact shadows) hidden once the unit is jacked up. */
  hideWhenRaised?: THREE.Object3D[];
  /** Longest jack (m); a wide unit on a steep slope needs more than the default. */
  maxRise?: number;
  /** Loose material (regolith piles): no jacks; settle to the lowest point so it never floats. */
  sink?: boolean;
}

/** Give a structure leveling jacks under its feet. Call once per unit; the root's own unit first. */
export function addFooting(root: THREE.Object3D, opts: FootingOptions): void {
  const parent = opts.node ?? root;
  const w = opts.width ?? 0.16;
  const cx = opts.feet.reduce((s, f) => s + f[0], 0) / opts.feet.length;
  const cz = opts.feet.reduce((s, f) => s + f[1], 0) / opts.feet.length;
  const jacks = opts.feet.map(([x, z]): Jack => {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const column = new THREE.Mesh(unitBox, jackMetal);
    column.scale.set(w, 1, w);
    const pad = new THREE.Mesh(padGeo, jackDark);
    pad.scale.set(w * 1.6, 0.08, w * 1.6);
    const brace = new THREE.Mesh(unitRod, jackMetal);
    for (const m of [column, pad, brace]) { m.castShadow = true; m.receiveShadow = false; }
    group.add(column, pad, brace);
    group.visible = false;
    parent.add(group);
    const d = Math.hypot(cx - x, cz - z) || 1;
    return { x, z, group, column, pad, brace, inward: [(cx - x) / d, (cz - z) / d] };
  });
  const unit: Unit = { node: opts.node ?? null, jacks, probes: opts.probes ?? [], hideWhenRaised: opts.hideWhenRaised ?? [], maxRise: opts.maxRise ?? MAX_RISE_M, sink: opts.sink ?? false };
  (root.userData.footing ??= []).push(unit);
}

/** Let a vehicle tilt to the ground under it; wheels at ±halfX, ±halfZ. Its rotation order becomes YXZ. */
export function tiltWithGround(root: THREE.Object3D, halfX: number, halfZ: number): void {
  root.rotation.order = 'YXZ'; // turning (y) outermost, so setting rotation.y keeps the tilt meaningful
  root.userData.tilt = { halfX, halfZ } satisfies Tilt;
}

/**
 * Fit a placed prop to the ground: level structures on their jacks, tilt
 * vehicles. Returns how far (m, prop frame) the root itself should be raised.
 */
export function settle(root: THREE.Object3D, ground: GroundSampler): number {
  const tilt = root.userData.tilt as Tilt | undefined;
  if (tilt) {
    const sx = (ground(tilt.halfX, 0) - ground(-tilt.halfX, 0)) / (2 * tilt.halfX);
    const sz = (ground(0, tilt.halfZ) - ground(0, -tilt.halfZ)) / (2 * tilt.halfZ);
    const clamp = (a: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, a));
    root.rotation.z = clamp(Math.atan(sx)); // +x rises
    root.rotation.x = clamp(-Math.atan(sz)); // +z rises
    return 0;
  }
  const units = root.userData.footing as Unit[] | undefined;
  if (!units) return 0;
  let rootLift = 0;
  for (const unit of units) {
    const ox = unit.node?.position.x ?? 0;
    const oz = unit.node?.position.z ?? 0;
    const at = (x: number, z: number) => ground(x + ox, z + oz) - rootLift;
    const feet = unit.jacks.map((j) => at(j.x, j.z));
    const all = feet.concat(unit.probes.map(([x, z]) => at(x, z)));
    const low = Math.min(...feet);
    const base = unit.sink ? low : Math.min(Math.max(...all), low + unit.maxRise);
    if (unit.node) unit.node.position.y = base;
    else rootLift = base;
    unit.jacks.forEach((j, i) => fitJack(j, unit.sink ? 0 : base - feet[i]));
    for (const o of unit.hideWhenRaised) o.visible = base - low < 0.25;
  }
  return rootLift;
}

/** Stretch a jack down by `drop` metres from the unit's base (y = 0 of its node). */
function fitJack(j: Jack, drop: number): void {
  j.group.visible = drop > MIN_JACK_M;
  if (!j.group.visible) return;
  j.column.scale.y = drop;
  j.column.position.y = -drop / 2;
  j.pad.position.y = -drop + 0.04;
  j.brace.visible = drop > BRACE_FROM_M;
  if (!j.brace.visible) return;
  // A knee brace from low on the column up to the underside of the unit, inboard.
  const reach = Math.min(2.5, drop * 0.6);
  const a = new THREE.Vector3(0, -drop * 0.7, 0);
  const b = new THREE.Vector3(j.inward[0] * reach, 0, j.inward[1] * reach);
  const d = b.clone().sub(a);
  j.brace.scale.set(0.035, d.length(), 0.035);
  j.brace.position.copy(a).addScaledVector(d, 0.5);
  j.brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}

/** Points evenly round a circle, for feet and probes. */
export function ring(r: number, n: number, offsetRad = 0, cx = 0, cz = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = offsetRad + (i * 2 * Math.PI) / n;
    return [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
  });
}
