// 3D pin visuals for the site picker globe: shaded metallic head and stalk,
// dark silhouette outlines for high contrast against lunar terrain, and
// smooth interactive hover and selected states.

import * as THREE from 'three';

export const SUN_GOLD = 0xffc845;
export const STALK_LEN = 0.07;
export const HEAD_RADIUS = 0.0125;
export const HEAD_OUTLINE_RADIUS = 0.0152;
export const STALK_RADIUS_TOP = 0.0030;
export const STALK_RADIUS_BOTTOM = 0.0016;
export const STALK_OUTLINE_RADIUS_TOP = 0.0046;
export const STALK_OUTLINE_RADIUS_BOTTOM = 0.0032;
export const ANCHOR_RADIUS = 0.0032;
export const ANCHOR_OUTLINE_RADIUS = 0.0048;

export interface PinVisual {
  group: THREE.Group;
  head: THREE.Mesh;
  stalk: THREE.Mesh;
  headOutline: THREE.Mesh;
  stalkOutline: THREE.Mesh;
  anchor: THREE.Mesh;
  anchorOutline: THREE.Mesh;
  hit: THREE.Mesh;
  setState(selected: boolean, hovered: boolean): void;
}

export class PinVisualFactory {
  private outlineMat: THREE.MeshBasicMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private headHoverMat: THREE.MeshStandardMaterial;
  private headSelectedMat: THREE.MeshStandardMaterial;
  private stalkMat: THREE.MeshStandardMaterial;

  private headGeo: THREE.SphereGeometry;
  private headOutlineGeo: THREE.SphereGeometry;
  private stalkGeo: THREE.CylinderGeometry;
  private stalkOutlineGeo: THREE.CylinderGeometry;
  private anchorGeo: THREE.SphereGeometry;
  private anchorOutlineGeo: THREE.SphereGeometry;
  private hitGeo: THREE.SphereGeometry;

  constructor() {
    // Crisp dark silhouette outline using inverted hull (BackSide)
    this.outlineMat = new THREE.MeshBasicMaterial({
      color: 0x05070a,
      side: THREE.BackSide,
    });

    // Lustrous sun-gold head with smooth specular highlight and warm ambient glow
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0xffbe1a,
      roughness: 0.20,
      metalness: 0.15,
      emissive: 0x442a00,
    });

    this.headHoverMat = new THREE.MeshStandardMaterial({
      color: 0xffcf40,
      roughness: 0.16,
      metalness: 0.20,
      emissive: 0x5a3c00,
    });

    this.headSelectedMat = new THREE.MeshStandardMaterial({
      color: 0xffe270,
      roughness: 0.12,
      metalness: 0.25,
      emissive: 0x774e00,
    });

    // Metallic golden brass needle with longitudinal specular highlight
    this.stalkMat = new THREE.MeshStandardMaterial({
      color: 0xf5c242,
      roughness: 0.28,
      metalness: 0.55,
      emissive: 0x332200,
    });

    // High-resolution smooth geometries (no faceted edges or wonky polygons)
    this.headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 32, 24);
    this.headOutlineGeo = new THREE.SphereGeometry(HEAD_OUTLINE_RADIUS, 32, 24);
    this.stalkGeo = new THREE.CylinderGeometry(STALK_RADIUS_TOP, STALK_RADIUS_BOTTOM, STALK_LEN, 24);
    this.stalkOutlineGeo = new THREE.CylinderGeometry(
      STALK_OUTLINE_RADIUS_TOP,
      STALK_OUTLINE_RADIUS_BOTTOM,
      STALK_LEN,
      24,
      1,
      true, // openEnded: true creates clean tube outline without cap artifacts
    );
    this.anchorGeo = new THREE.SphereGeometry(ANCHOR_RADIUS, 20, 16);
    this.anchorOutlineGeo = new THREE.SphereGeometry(ANCHOR_OUTLINE_RADIUS, 20, 16);
    this.hitGeo = new THREE.SphereGeometry(0.05, 8, 6);
  }

  createPin(): PinVisual {
    const group = new THREE.Group();
    group.renderOrder = 5;

    // 1. Base anchor bead planting needle into the lunar terrain
    const anchor = new THREE.Mesh(this.anchorGeo, this.stalkMat);
    anchor.position.y = 0.002;
    anchor.renderOrder = 5;

    const anchorOutline = new THREE.Mesh(this.anchorOutlineGeo, this.outlineMat);
    anchorOutline.renderOrder = 5;
    anchor.add(anchorOutline);

    // 2. Tapered metallic needle with dark side outline
    const stalk = new THREE.Mesh(this.stalkGeo, this.stalkMat);
    stalk.position.y = STALK_LEN / 2;
    stalk.renderOrder = 5;

    const stalkOutline = new THREE.Mesh(this.stalkOutlineGeo, this.outlineMat);
    stalkOutline.renderOrder = 5;
    stalk.add(stalkOutline);

    // 3. Spherical head with dark contour outline shell
    const head = new THREE.Mesh(this.headGeo, this.headMat);
    head.position.y = STALK_LEN;
    head.renderOrder = 5;

    const headOutline = new THREE.Mesh(this.headOutlineGeo, this.outlineMat);
    headOutline.renderOrder = 5;
    head.add(headOutline);

    // 4. Generous invisible hit volume for effortless mouse picking
    const hit = new THREE.Mesh(
      this.hitGeo,
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = STALK_LEN;

    group.add(anchor, stalk, head, hit);

    const setState = (selected: boolean, hovered: boolean) => {
      const scale = selected ? 1.6 : hovered ? 1.25 : 1.0;
      head.scale.setScalar(scale);
      head.material = selected
        ? this.headSelectedMat
        : hovered
          ? this.headHoverMat
          : this.headMat;
    };

    return {
      group,
      head,
      stalk,
      headOutline,
      stalkOutline,
      anchor,
      anchorOutline,
      hit,
      setState,
    };
  }

  dispose(): void {
    this.outlineMat.dispose();
    this.headMat.dispose();
    this.headHoverMat.dispose();
    this.headSelectedMat.dispose();
    this.stalkMat.dispose();
    this.headGeo.dispose();
    this.headOutlineGeo.dispose();
    this.stalkGeo.dispose();
    this.stalkOutlineGeo.dispose();
    this.anchorGeo.dispose();
    this.anchorOutlineGeo.dispose();
    this.hitGeo.dispose();
  }
}
