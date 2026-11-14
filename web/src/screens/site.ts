// Panorama screen for one site: loads the data, works out the physics for the
// chosen hour, and shows it in either the 3D scene or the 2D strip.

import { loadSite, loadTerrain } from '../data/load';
import type { SiteData } from '../data/types';
import { Panorama } from '../panorama/Panorama';
import { maskAt, vecToAzEl } from '../panorama/geometry';
import type { PanoramaView } from '../panorama/view';
import type { Heightmap } from '../panorama3d/heightmap';
import type { Vec3 } from '../panorama3d/mapping';
import { Scene3D } from '../panorama3d/Scene3D';
import { earthRadiusDeg, sunRadiusDeg } from '../physics/constants';
import { bodyAboveHorizon } from '../physics/visibility';

type Mode = '3d' | '2d';

const TRACK_HOURS = 709; // ~29.5 days: one trip of the Sun around the horizon
const EARTH_RADIUS_FALLBACK_DEG = 0.95; // only for files without earth.r_km (fake data)
const MARGIN_DEG = 0.5;

/** Dev-only: ?hour=N picks a time sample until the time slider arrives (milestone 4). */
function hourFromUrl(count: number): number {
  const raw = new URLSearchParams(window.location.search).get('hour');
  const n = raw === null ? 0 : Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), count - 1) : 0;
}

function modeFromUrl(): Mode {
  return new URLSearchParams(window.location.search).get('view') === '2d' ? '2d' : '3d';
}

function vec(v: { e: number[]; n: number[]; u: number[] }, k: number): Vec3 {
  return [v.e[k], v.n[k], v.u[k]];
}

/**
 * Elevation range to keep on screen for the whole year, so the stretch stays
 * fixed while time moves: from just below the lowest horizon to just above
 * the tallest ridge or the highest Sun/Earth (plus their radius).
 */
function elevationRange(data: SiteData, mask: number[], sunR: number, earthR: number): [number, number] {
  const maxElev = (u: number[]) => Math.asin(Math.max(...u)) * (180 / Math.PI);
  const top = Math.max(Math.max(...mask), maxElev(data.sun.u) + sunR, maxElev(data.earth.u) + earthR);
  return [Math.min(...mask) - MARGIN_DEG, top + MARGIN_DEG];
}

function showBadge(data: SiteData): void {
  const badge = document.getElementById('badge')!;
  badge.hidden = true;
  if (data.fake) {
    badge.textContent = 'FAKE DATA';
    badge.hidden = false;
  } else if (data.mask_fake) {
    badge.textContent = 'TERRAIN NOT REAL YET';
    badge.hidden = false;
  }
}

export async function openSite(id: string): Promise<void> {
  const data = await loadSite(id);
  let terrain: Heightmap | null = null;
  if (data.terrain) {
    try {
      terrain = await loadTerrain(data.terrain);
    } catch (err) {
      console.error(err); // the 3D view still works with rings only
    }
  }
  showBadge(data);
  document.title = `${data.site.name} · Lunar Landing Site Navigator`;

  const center = data.grid.points.find((p) => p.dx_km === 0 && p.dy_km === 0) ?? data.grid.points[0];
  const mask = center.mask_deg;
  const bands = center.mask_bands_deg ?? null;
  const mastM = data.site.mast_height_m ?? 3;

  // ---- Physics for the chosen hour (the only source of lit / visible) ----
  const k = hourFromUrl(data.time.count);
  const sunEnu = vec(data.sun, k);
  const earthEnu = vec(data.earth, k);
  const sun = vecToAzEl(...sunEnu);
  const earth = vecToAzEl(...earthEnu);
  const sunLit = bodyAboveHorizon(sun, mask);
  const earthVisible = bodyAboveHorizon(earth, mask);
  const sunR = sunRadiusDeg(data.sun.r_au[k]);
  const earthR = data.earth.r_km ? earthRadiusDeg(data.earth.r_km[k]) : EARTH_RADIUS_FALLBACK_DEG;
  const sunRMax = sunRadiusDeg(Math.min(...data.sun.r_au));
  const earthRMax = data.earth.r_km ? earthRadiusDeg(Math.min(...data.earth.r_km)) : EARTH_RADIUS_FALLBACK_DEG;
  const elRange = elevationRange(data, mask, sunRMax, earthRMax);

  const end = Math.min(k + TRACK_HOURS, data.time.count);
  const track = (v: typeof data.sun | typeof data.earth) =>
    Array.from({ length: end - k }, (_, i) => vec(v, k + i));

  // ---- Views ----
  const canvas2d = document.getElementById('panorama') as HTMLCanvasElement;
  const canvas3d = document.getElementById('pano3d') as HTMLCanvasElement;
  const fallback = document.getElementById('pano3d-fallback')!;
  const btn3d = document.getElementById('mode-3d') as HTMLButtonElement;
  const btn2d = document.getElementById('mode-2d') as HTMLButtonElement;
  const btnTrue = document.getElementById('true-scale') as HTMLButtonElement;
  const readout = document.getElementById('readout')!;

  const flat = new Panorama(canvas2d);
  flat.setMask(mask, bands);
  flat.fitElevations(...elRange);
  flat.setBodies(sun, earth);

  let scene: Scene3D | null = null;
  try {
    scene = new Scene3D(canvas3d);
    scene.setSite({ mask, bands, terrain, mastM, elRange, landerAz: sun.az - 30 });
    scene.setTime({
      sunEnu, earthEnu, sunRadiusDeg: sunR, earthRadiusDeg: earthR,
      sunTrack: track(data.sun), earthTrack: track(data.earth), sunLit,
    });
  } catch (err) {
    console.error(err);
    scene = null;
  }

  let mode: Mode = scene ? modeFromUrl() : '2d';
  let active: PanoramaView = flat;
  let trueScale = false;

  const t = new Date(Date.parse(data.time.start) + k * data.time.step_hours * 3600_000);
  const when = t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const fmt = (v: number) => v.toFixed(2).padStart(6);
  const state = (yes: boolean, on: string, off: string) => (yes ? on : off);
  const update = () => {
    readout.textContent =
      `${data.site.name}   ${when} (hour ${k})   view ${fmt(active.yaw)}°   ${mode.toUpperCase()}   vertical ×${active.exaggeration.toFixed(1)}\n` +
      `sun   az ${fmt(sun.az)}° el ${fmt(sun.el)}°  (horizon there ${fmt(maskAt(mask, sun.az))}°)  ${state(sunLit, 'LIT', 'behind terrain')}\n` +
      `earth az ${fmt(earth.az)}° el ${fmt(earth.el)}°  (horizon there ${fmt(maskAt(mask, earth.az))}°)  ${state(earthVisible, 'VISIBLE', 'behind terrain')}`;
  };

  const setMode = (next: Mode) => {
    if (next === '3d' && !scene) next = '2d';
    const yaw = active.yaw;
    mode = next;
    active = next === '3d' && scene ? scene : flat;
    flat.setActive(active === flat);
    scene?.setActive(active === scene);
    active.setYaw(yaw);
    btn3d.setAttribute('aria-pressed', String(next === '3d'));
    btn2d.setAttribute('aria-pressed', String(next === '2d'));
    const params = new URLSearchParams(window.location.search);
    params.set('view', next);
    history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
    update();
  };

  const onLost = () => {
    scene = null;
    fallback.hidden = false;
    btn3d.disabled = true;
    setMode('2d');
  };
  if (scene) scene.onContextLost = onLost;
  else {
    fallback.hidden = false;
    btn3d.disabled = true;
  }

  flat.onChange = () => active === flat && update();
  if (scene) scene.onChange = () => active === scene && update();
  btn3d.onclick = () => setMode('3d');
  btn2d.onclick = () => setMode('2d');
  btnTrue.onclick = () => {
    trueScale = !trueScale;
    btnTrue.setAttribute('aria-pressed', String(trueScale));
    flat.setTrueScale(trueScale);
    scene?.setTrueScale(trueScale);
    update();
  };

  flat.setYaw(sun.az);
  scene?.setYaw(sun.az);
  setMode(mode);
}
