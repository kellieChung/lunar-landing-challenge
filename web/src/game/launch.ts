// The launch cinematic (rendering only; the rules already launched). About
// nine seconds: the view pushes in on the pad, counts down 3-2-1, the ascent
// stage lights up, throws a ring of regolith across the pad and climbs, then
// pitches over downrange like the real LM while the view follows it. The
// descent stage stays behind on the pad. Any click, tap or key skips to the end.

import * as THREE from 'three';
import type { Scene3D, ViewState } from '../panorama3d/Scene3D';
import { smoothstep } from '../panorama3d/Scene3D';
import type { Rocket } from './props';
import { turn } from './roverViz';
import { el } from './ui/dom';
import { sfx } from './ui/sound';

const PUSH_S = 1.2;
const BEATS = [1.3, 2.1, 2.9]; // "3", "2", "1"
const IGNITE_S = 3.7;
const END_S = 9.2;
const THRUST = 11; // m/s^2 (gameplay, not the LM's gentle 3)
const MOON_G = 1.62;
const PITCH_OVER: [number, number] = [1.0, 3.2]; // s after ignition
const PITCH_MAX = 52 * (Math.PI / 180);
const EXHAUST_M_S = 28;

export interface LaunchShow {
  scene: Scene3D;
  rocket: Rocket;
  stage: HTMLElement; // where the overlay goes (the 3D view's container)
  root: HTMLElement; // gets .g-cinematic, which hides the HUD
  reduced: boolean; // prefers-reduced-motion
  onDone: () => void;
}

let glowTexture: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,245,1)');
  grad.addColorStop(0.25, 'rgba(255,214,150,0.9)');
  grad.addColorStop(0.6, 'rgba(255,140,60,0.25)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function playLaunch(show: LaunchShow): () => void {
  const { scene, rocket, stage, root, reduced } = show;
  const k = scene.exaggeration;
  const body = rocket.body;
  const start: ViewState = scene.getView();

  // ---- Overlay: letterbox, numerals, flash, skip hint ----
  const overlay = el('div', 'g-cine');
  const num = el('div', 'g-cine-num');
  const flashEl = el('div', 'g-cine-flash');
  const hint = el('div', 'g-cine-skip');
  hint.textContent = 'Click to skip';
  overlay.append(el('div', 'g-cine-bar g-cine-top'), el('div', 'g-cine-bar g-cine-bottom'), flashEl, num, hint);
  stage.append(overlay);
  root.classList.add('g-cinematic');
  requestAnimationFrame(() => overlay.classList.add('on'));
  const say = (text: string, big = false) => {
    const n = el('span', big ? 'g-cine-word big' : 'g-cine-word');
    n.textContent = text;
    num.replaceChildren(n);
  };

  // ---- Where things are ----
  rocket.group.updateMatrixWorld(true);
  const padWorld = rocket.group.getWorldPosition(new THREE.Vector3());
  const box = new THREE.Box3().setFromObject(body);
  const bodyWorld0 = body.getWorldPosition(new THREE.Vector3());
  const nozzleOffset = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2).sub(bodyWorld0);
  const middleOffset = box.getCenter(new THREE.Vector3()).sub(bodyWorld0);
  const body0 = body.position.clone();
  // Downrange: across the sky and a little away, so the climb stays in view.
  const radial = new THREE.Vector3(padWorld.x, 0, padWorld.z).normalize();
  const across = new THREE.Vector3(-radial.z, 0, radial.x);
  const downrange = across.multiplyScalar(0.8).addScaledVector(radial, 0.6).normalize();
  const tiltAxis = new THREE.Vector3(downrange.z, 0, -downrange.x); // up x downrange

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
  }));
  scene.fx.group.add(sprite);

  // ---- The camera: push in, then follow ----
  const aim0 = scene.aimAt(padWorld.clone().addScaledVector(new THREE.Vector3(0, 1, 0), 3.5 * k));
  scene.cinematic = true;
  const push = scene.tweenView({ yaw: aim0.yaw, pitch: aim0.pitch + 2, zoom: 0.42 }, PUSH_S);

  // ---- Flight (true metres, in the pad's frame) ----
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const thrustDir = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Quaternion();
  let t = 0;
  let beat = 0;
  let ignited = false;
  let ended = false;

  const nozzleWorld = () => body.getWorldPosition(new THREE.Vector3()).add(nozzleOffset.clone().applyQuaternion(tilt));

  const ignite = () => {
    ignited = true;
    push.cancel();
    say('Liftoff!', true);
    sfx.tick(true);
    sfx.rumble(5);
    flashEl.classList.add('go');
    const n = nozzleWorld();
    scene.flash(n, 40, 1.4, 60);
    scene.fx.blast(padWorld.clone().setY(padWorld.y + 0.3 * k), { count: 260, speedM: 20 });
    if (!reduced) scene.shake(0.5, 1.6);
  };

  const flyStep = (dt: number) => {
    const tl = t - IGNITE_S;
    const theta = PITCH_MAX * smoothstep(PITCH_OVER[0], PITCH_OVER[1], tl);
    thrustDir.set(0, Math.cos(theta), 0).addScaledVector(downrange, Math.sin(theta));
    vel.addScaledVector(thrustDir, THRUST * dt);
    vel.y -= MOON_G * dt;
    pos.addScaledVector(vel, dt);
    body.position.copy(body0).addScaledVector(pos, rocket.unitsPerM);
    tilt.setFromAxisAngle(tiltAxis, theta);
    body.quaternion.copy(tilt);
    body.updateMatrixWorld(true);
    scene.shadowsMoved();

    const n = nozzleWorld();
    const plume: [number, number, number] = [
      (-thrustDir.x * EXHAUST_M_S) + vel.x * 0.4, (-thrustDir.y * EXHAUST_M_S) + vel.y * 0.4, (-thrustDir.z * EXHAUST_M_S) + vel.z * 0.4,
    ];
    scene.fx.exhaust(n, plume, { count: reduced ? 3 : 6, sizeM: 1.3 });
    if (pos.y < 18 && tl < 2) {
      scene.fx.blast(padWorld.clone().setY(padWorld.y + 0.3 * k), { count: reduced ? 4 : 10, speedM: 14 * (1 - pos.y / 18) + 4 });
    }
    // A glow that stays a visible dot as the stage shrinks into the sky.
    const dist = n.length();
    sprite.position.copy(n);
    sprite.scale.setScalar(Math.max(2.2 * k, dist * 0.018));
    sprite.material.opacity = Math.min(1, tl * 4) * (0.85 + 0.15 * Math.sin(t * 40));
  };

  const follow = (dt: number) => {
    const target = ignited
      ? scene.aimAt(body.getWorldPosition(new THREE.Vector3()).add(middleOffset.clone().applyQuaternion(tilt)))
      : aim0;
    const v = scene.getView();
    const f = Math.min(1, 4 * dt);
    const tl = Math.max(0, t - IGNITE_S);
    scene.setView({
      yaw: v.yaw + turn(v.yaw, target.yaw) * f,
      pitch: v.pitch + (target.pitch + 1 - v.pitch) * f,
      zoom: 0.42 + (0.75 - 0.42) * smoothstep(0.8, 4.5, tl),
    });
  };

  const stopTicker = scene.addTicker((dt) => {
    if (ended) return false;
    t += dt;
    while (beat < BEATS.length && t >= BEATS[beat]) {
      say(String(3 - beat));
      sfx.tick();
      beat++;
    }
    if (!ignited && t >= IGNITE_S) ignite();
    if (ignited) flyStep(dt);
    if (t >= PUSH_S) follow(dt);
    if (t > IGNITE_S + 1.2) num.classList.add('fade');
    if (t >= END_S) finish();
    return !ended;
  });

  function finish(): void {
    if (ended) return;
    ended = true;
    stopTicker();
    push.cancel();
    document.removeEventListener('keydown', onKey, true);
    overlay.removeEventListener('pointerdown', onSkip);
    scene.fx.group.remove(sprite);
    sprite.material.dispose();
    body.visible = false; // gone to orbit
    scene.shadowsMoved();
    scene.cinematic = false;
    scene.setView(start);
    root.classList.remove('g-cinematic');
    overlay.classList.remove('on');
    window.setTimeout(() => overlay.remove(), 400);
    show.onDone();
  }
  const onSkip = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    finish();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === ' ' || ev.key === 'Escape' || ev.key === 'Enter') onSkip(ev);
  };
  overlay.addEventListener('pointerdown', onSkip);
  document.addEventListener('keydown', onKey, true);
  return finish;
}
