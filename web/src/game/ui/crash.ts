// The opening cutscene, in the 3D scene with the NASA lander: while Astrofrog
// radios the mayday, the lander comes down out of the black sky, wobbling,
// engine sputtering and venting fuel. It hovers low until land() is called
// (the lines are done), then drops onto its pad: dust ring, thump, shake.
// A thin DOM layer adds the red alarm edge and the FUEL LEAK sign.

import * as THREE from 'three';
import type { Scene3D } from '../../panorama3d/Scene3D';
import { smoothstep } from '../../panorama3d/Scene3D';
import { el } from './dom';
import { sfx } from './sound';

const DROP_M = 70; // starts this high above the pad
const HOVER_M = 9; // waits here for the last line
const DESCENT_S = 7;
const FINAL_S = 1.1; // hover to pad

export interface CrashScene {
  /** Touch down and clean up. Resolves when the scene is back to normal. */
  land(): Promise<void>;
}

export function playCrash(scene: Scene3D | null, stage: HTMLElement, root: HTMLElement, reduced: boolean): CrashScene {
  const overlay = el('div', 'g-crash');
  overlay.append(el('div', 'g-crash-alarm'), el('div', 'g-crash-warn', '⚠ FUEL LEAK ⚠'));
  stage.append(overlay);
  root.classList.add('g-cinematic');
  requestAnimationFrame(() => overlay.classList.add('on'));

  const cleanupDom = () => {
    overlay.classList.remove('on');
    root.classList.remove('g-cinematic');
    window.setTimeout(() => overlay.remove(), 500);
  };
  if (!scene || reduced) {
    return { land: () => { cleanupDom(); return Promise.resolve(); } };
  }

  const lander = scene.landerGroup;
  const pad = lander.position.clone();
  const rot0 = lander.rotation.clone();
  const view0 = scene.getView();
  const u = lander.scale.x; // scene units per metre
  const box = new THREE.Box3().setFromObject(lander);
  const midUp = (box.max.y - box.min.y) / 2;
  // It comes in on a slant from out past the pad, so it stays in the view instead of straight overhead.
  const out = new THREE.Vector3(pad.x, 0, pad.z).normalize();
  const leakSide = new THREE.Vector3(pad.z, 0, -pad.x).normalize(); // sideways as seen from the eye

  scene.cinematic = true;
  let t = 0;
  let heightM = DROP_M;
  let landing: { t0: number; from: number; done: () => void } | null = null;
  let ended = false;

  const place = () => {
    const wob = landing ? 0.35 : 1;
    lander.position.set(pad.x, pad.y + heightM * u, pad.z).addScaledVector(out, 2.2 * heightM * u);
    lander.rotation.set(
      rot0.x + 0.16 * wob * Math.sin(t * 2.3),
      rot0.y + 0.25 * Math.sin(t * 0.7),
      rot0.z + 0.2 * wob * Math.sin(t * 1.7 + 1),
    );
    lander.updateMatrixWorld(true);
    scene.shadowsMoved();
  };
  place();

  const stop = scene.addTicker((dt) => {
    if (ended) return false;
    t += dt;
    if (landing) {
      const f = Math.min(1, (t - landing.t0) / FINAL_S);
      heightM = landing.from * (1 - f * f); // falling, faster at the end
      if (f >= 1) touchdown();
    } else {
      heightM = HOVER_M + (DROP_M - HOVER_M) * (1 - smoothstep(0, DESCENT_S, t));
    }
    place();
    const nozzle = lander.position.clone();
    // Sputtering engine: on most frames, cutting out now and then.
    if (Math.sin(t * 13) + Math.sin(t * 7.1) > -0.9) {
      scene.fx.exhaust(nozzle, [0, -24, 0], { count: 4, sizeM: 1.1 });
    }
    // Fuel venting from one side: pale blue spray.
    const leak = nozzle.clone().addScaledVector(new THREE.Vector3(0, 1, 0), midUp).addScaledVector(leakSide, 1.6 * u);
    scene.fx.emit({
      at: leak, count: 3, spreadM: 0.2, vel: [leakSide.x * 6, 1.5, leakSide.z * 6], jitterM: 1.4,
      life: [0.6, 1.3], sizeM: [0.3, 1.4], color: 0xbfe6ff, alpha: 0.6, drag: 0.4,
    });
    // Camera follows the lander, pulled in close.
    const aim = scene.aimAt(lander.position.clone().addScaledVector(new THREE.Vector3(0, 1, 0), midUp));
    const v = scene.getView();
    const k = Math.min(1, 3 * dt);
    let dy = aim.yaw - v.yaw;
    dy = ((dy % 360) + 540) % 360 - 180;
    scene.setView({ yaw: v.yaw + dy * k, pitch: v.pitch + (aim.pitch - v.pitch) * k, zoom: v.zoom + (0.55 - v.zoom) * k });
    return true;
  });

  function touchdown(): void {
    if (ended) return;
    ended = true;
    stop();
    lander.position.copy(pad);
    lander.rotation.set(rot0.x, rot0.y, rot0.z + 0.05); // a little crooked: it was a rough one
    lander.updateMatrixWorld(true);
    scene!.shadowsMoved();
    scene!.fx.blast(pad.clone().setY(pad.y + 0.3 * u), { count: 240, speedM: 14 });
    scene!.shake(0.8, 1.2);
    sfx.rumble(0.8);
    overlay.classList.add('down');
    const done = landing!.done;
    window.setTimeout(() => {
      scene!.cinematic = false;
      void scene!.tweenView(view0, 1.2).done.then(() => { cleanupDom(); done(); });
    }, 1200);
  }

  return {
    land: () => new Promise<void>((done) => {
      landing = { t0: t, from: heightM, done };
    }),
  };
}
