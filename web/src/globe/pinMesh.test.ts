import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PinVisualFactory,
  HEAD_RADIUS,
  HEAD_OUTLINE_RADIUS,
  STALK_LEN,
  STALK_RADIUS_TOP,
  STALK_RADIUS_BOTTOM,
} from './pinMesh';

describe('PinVisualFactory', () => {
  it('creates pin visual with proper hierarchy and components', () => {
    const factory = new PinVisualFactory();
    const pin = factory.createPin();

    expect(pin.group).toBeInstanceOf(THREE.Group);
    expect(pin.head).toBeInstanceOf(THREE.Mesh);
    expect(pin.stalk).toBeInstanceOf(THREE.Mesh);
    expect(pin.headOutline).toBeInstanceOf(THREE.Mesh);
    expect(pin.stalkOutline).toBeInstanceOf(THREE.Mesh);
    expect(pin.anchor).toBeInstanceOf(THREE.Mesh);
    expect(pin.anchorOutline).toBeInstanceOf(THREE.Mesh);
    expect(pin.hit).toBeInstanceOf(THREE.Mesh);

    // Group should contain anchor, stalk, head, hit
    expect(pin.group.children).toContain(pin.anchor);
    expect(pin.group.children).toContain(pin.stalk);
    expect(pin.group.children).toContain(pin.head);
    expect(pin.group.children).toContain(pin.hit);

    // Outlines should be children of respective parts for automatic scale/transform inheritance
    expect(pin.head.children).toContain(pin.headOutline);
    expect(pin.stalk.children).toContain(pin.stalkOutline);
    expect(pin.anchor.children).toContain(pin.anchorOutline);
  });

  it('configures materials for shading and inverted-hull outlines', () => {
    const factory = new PinVisualFactory();
    const pin = factory.createPin();

    // Head and stalk use MeshStandardMaterial for 3D lighting, diffuse falloff, and specular highlights
    expect(pin.head.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(pin.stalk.material).toBeInstanceOf(THREE.MeshStandardMaterial);

    const headMat = pin.head.material as THREE.MeshStandardMaterial;
    expect(headMat.roughness).toBeLessThan(0.3);
    expect(headMat.emissive.getHex()).toBeGreaterThan(0);

    const stalkMat = pin.stalk.material as THREE.MeshStandardMaterial;
    expect(stalkMat.metalness).toBeGreaterThan(0.4);

    // Outline materials must use BackSide
    const headOutlineMat = pin.headOutline.material as THREE.MeshBasicMaterial;
    expect(headOutlineMat.side).toBe(THREE.BackSide);

    const stalkOutlineMat = pin.stalkOutline.material as THREE.MeshBasicMaterial;
    expect(stalkOutlineMat.side).toBe(THREE.BackSide);
  });

  it('has correct geometric dimensions and needle positioning', () => {
    const factory = new PinVisualFactory();
    const pin = factory.createPin();

    expect(pin.head.position.y).toBe(STALK_LEN);
    expect(pin.stalk.position.y).toBe(STALK_LEN / 2);
    expect(pin.anchor.position.y).toBeCloseTo(0.002, 3);
    expect(pin.hit.position.y).toBe(STALK_LEN);

    // Verify head outline is larger than head
    expect(HEAD_OUTLINE_RADIUS).toBeGreaterThan(HEAD_RADIUS);
    // Verify stalk is tapered
    expect(STALK_RADIUS_TOP).toBeGreaterThan(STALK_RADIUS_BOTTOM);
  });

  it('updates state on select and hover', () => {
    const factory = new PinVisualFactory();
    const pin = factory.createPin();

    // Default state: scale 1.0
    expect(pin.head.scale.x).toBe(1.0);

    // Hover state: scale 1.25
    pin.setState(false, true);
    expect(pin.head.scale.x).toBeCloseTo(1.25, 2);

    // Selected state: scale 1.6
    pin.setState(true, false);
    expect(pin.head.scale.x).toBeCloseTo(1.6, 2);

    // Idle state: scale 1.0
    pin.setState(false, false);
    expect(pin.head.scale.x).toBe(1.0);
  });
});
