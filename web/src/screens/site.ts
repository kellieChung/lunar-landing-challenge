// Panorama screen for one site: loads the data, works out the physics for the
// current time (moved by the time bar), and shows it in the 3D scene or the
// 2D strip plus the stats panel.

import { loadSite, loadTerrain } from '../data/load';
import type { SiteData } from '../data/types';
import { Panorama } from '../panorama/Panorama';
import { maskAt, vecToAzEl } from '../panorama/geometry';
import type { PanoramaView } from '../panorama/view';
import { crop, recenter, type Heightmap } from '../panorama3d/heightmap';
import type { Vec3 } from '../panorama3d/mapping';
import { Scene3D } from '../panorama3d/Scene3D';
import { earthRadiusDeg, sunRadiusDeg } from '../physics/constants';
import { earthVisibleAt, nextChange, stateSince, sunLitAt } from '../physics/events';
import { describeOffset, findPoint, pointVectors } from '../physics/grid';
import { fluxWm2, siteSeries, windowMetrics } from '../physics/metrics';
import { batteryState, signalBars } from '../physics/status';
import { sampleDate, valueAt, vectorAt, type VectorSeries } from '../physics/time';
import { LIT_THRESHOLD, marginDeg, sunlitFraction } from '../physics/visibility';
import { StatsPanel } from '../ui/StatsPanel';
import { formatUtc, PAGE_SAMPLES, TimeBar } from '../ui/TimeBar';

type Mode = '3d' | '2d';

const TRACK_HOURS = 709; // ~29.5 days: one trip of the Sun around the horizon
const EARTH_RADIUS_FALLBACK_DEG = 0.95; // only for files without earth.r_km (fake data)
const MARGIN_DEG = 0.5;
const NEAR_TERRAIN_HALF_M = 5000; // the 3D view draws 10 x 10 km of ground around the observer

/** ?hour=N (sample index, fractions allowed) opens at that time; kept up to date when time settles. */
function hourFromUrl(count: number): number {
  const raw = new URLSearchParams(window.location.search).get('hour');
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), count - 1) : 0;
}

function setUrlParam(key: string, value: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set(key, value);
  history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

function modeFromUrl(): Mode {
  return new URLSearchParams(window.location.search).get('view') === '2d' ? '2d' : '3d';
}

function vec(v: VectorSeries, k: number): Vec3 {
  return [v.e[k], v.n[k], v.u[k]];
}

/**
 * Elevation range to keep on screen for the whole year, so the stretch stays
 * fixed while time moves: from just below the lowest horizon to just above
 * the tallest ridge or the highest Sun/Earth (plus their radius).
 */
function elevationRange(sunU: ArrayLike<number>, earthU: ArrayLike<number>, mask: number[], sunR: number,
  earthR: number): [number, number] {
  const maxElev = (u: ArrayLike<number>) => Math.asin(Math.max(...Array.from(u))) * (180 / Math.PI);
  const top = Math.max(Math.max(...mask), maxElev(sunU) + sunR, maxElev(earthU) + earthR);
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

  // The grid point we stand on (?pt=i,j; default the site center).
  const point = findPoint(data.grid.points, new URLSearchParams(window.location.search).get('pt'));
  const atCenter = point.dx_km === 0 && point.dy_km === 0;
  if (!atCenter) setUrlParam('pt', `${point.i},${point.j}`);
  else if (new URLSearchParams(window.location.search).has('pt')) setUrlParam('pt', '0,0');

  let terrain: Heightmap | null = null;
  if (data.terrain) {
    try {
      const whole = await loadTerrain(data.terrain);
      // Rendering only: the ground around this point, levelled for it.
      terrain = crop(recenter(whole, point.dx_km * 1000, point.dy_km * 1000, data.terrain.ground_m), NEAR_TERRAIN_HALF_M);
    } catch (err) {
      console.error(err); // the 3D view still works with rings only
    }
  }
  showBadge(data);
  const spot = describeOffset(point.dx_km, point.dy_km);
  document.title = `${data.site.name}${atCenter ? '' : ` (${spot.replace(' of the site center', '')})`} · Lunar Landing Site Navigator`;
  const back = document.getElementById('back-link') as HTMLAnchorElement | null;
  if (back) back.href = `./?focus=${data.site.id}&pt=${point.i},${point.j}`;
  const spotLabel = document.getElementById('spot-label');
  if (spotLabel) {
    const dz = point.ground_m !== undefined && data.site.ground_height_m !== undefined
      ? point.ground_m - data.site.ground_height_m : null;
    spotLabel.textContent = atCenter ? `${data.site.name} · site center`
      : `${data.site.name} · ${spot}${dz === null ? '' : ` · ground ${dz >= 0 ? '+' : '−'}${Math.abs(dz).toFixed(0)} m`}`;
  }

  const mask = point.mask_deg;
  const bands = point.mask_bands_deg ?? null;
  const mastM = data.site.mast_height_m ?? 3;
  // Sun/Earth as seen from this point (the file holds them for the site center).
  const sunV = pointVectors(data.sun, point.up_tilt);
  const earthV = pointVectors(data.earth, point.up_tilt);

  // ---- Physics (the only source of lit / visible) ----
  const count = data.time.count;
  const step = data.time.step_hours;
  const series = siteSeries(sunV, earthV, mask);
  const year = windowMetrics(series, 0, count, step);
  const litAt = (t: number) => sunLitAt(sunV, mask, t);
  const earthAt = (t: number) => earthVisibleAt(earthV, mask, t);
  const earthRAt = (t: number) => (data.earth.r_km ? earthRadiusDeg(valueAt(data.earth.r_km, t)) : EARTH_RADIUS_FALLBACK_DEG);

  const sunRMax = sunRadiusDeg(Math.min(...data.sun.r_au));
  const earthRMax = data.earth.r_km ? earthRadiusDeg(Math.min(...data.earth.r_km)) : EARTH_RADIUS_FALLBACK_DEG;
  const elRange = elevationRange(sunV.u, earthV.u, mask, sunRMax, earthRMax);

  /** Everything about one moment t (fractional sample index). */
  const physicsAt = (t: number) => {
    const sunEnu = vectorAt(sunV, t);
    const earthEnu = vectorAt(earthV, t);
    const rAu = valueAt(data.sun.r_au, t);
    const sun = vecToAzEl(...sunEnu);
    const earth = vecToAzEl(...earthEnu);
    const sunFraction = sunlitFraction(...sunEnu, rAu, mask);
    const sunLit = sunFraction >= LIT_THRESHOLD; // same rule as litAt(t)
    const earthMargin = marginDeg(...earthEnu, mask);
    return {
      sunEnu, earthEnu, sun, earth, sunFraction, sunLit, earthMargin,
      earthVisible: earthMargin > 0,
      sunR: sunRadiusDeg(rAu),
      earthR: earthRAt(t),
      flux: fluxWm2(rAu, sunFraction, sun.el),
    };
  };

  let trackFrom = -1;
  let sunTrack: Vec3[] = [];
  let earthTrack: Vec3[] = [];
  const tracksAt = (t: number) => {
    const k = Math.floor(t);
    if (k !== trackFrom) { // the faint 29.5-day paths only change once per sample
      trackFrom = k;
      const end = Math.min(k + TRACK_HOURS, count);
      const track = (v: VectorSeries) => Array.from({ length: end - k }, (_, i) => vec(v, k + i));
      sunTrack = track(sunV);
      earthTrack = track(earthV);
    }
    return { sunTrack, earthTrack };
  };

  let t = hourFromUrl(count);
  let now = physicsAt(t);

  // ---- Views ----
  const canvas2d = document.getElementById('panorama') as HTMLCanvasElement;
  const canvas3d = document.getElementById('pano3d') as HTMLCanvasElement;
  const fallback = document.getElementById('pano3d-fallback')!;
  const btn3d = document.getElementById('mode-3d') as HTMLButtonElement;
  const btn2d = document.getElementById('mode-2d') as HTMLButtonElement;
  const btnTrue = document.getElementById('true-scale') as HTMLButtonElement;
  const readout = document.getElementById('readout')!;
  const stats = new StatsPanel(document.getElementById('stats')!);

  const flat = new Panorama(canvas2d);
  flat.setMask(mask, bands);
  flat.fitElevations(...elRange);
  flat.setBodies(now.sun, now.earth);

  let scene: Scene3D | null = null;
  try {
    scene = new Scene3D(canvas3d);
    scene.setSite({ mask, bands, terrain, mastM, elRange, landerAz: now.sun.az - 30 });
  } catch (err) {
    console.error(err);
    scene = null;
    canvas3d.hidden = true;
  }

  let mode: Mode = scene ? modeFromUrl() : '2d';
  let active: PanoramaView = flat;
  let trueScale = false;

  const fmt = (v: number) => v.toFixed(2).padStart(6);
  const state = (yes: boolean, on: string, off: string) => (yes ? on : off);
  const update = () => {
    const { sun, earth } = now;
    readout.textContent =
      `${data.site.name} · ${spot}   ${formatUtc(sampleDate(data.time.start, step, t))} (hour ${t.toFixed(2)})   view ${fmt(active.yaw)}°   ${mode.toUpperCase()}   vertical ×${active.exaggeration.toFixed(1)}\n` +
      `sun   az ${fmt(sun.az)}° el ${fmt(sun.el)}°  (horizon there ${fmt(maskAt(mask, sun.az))}°)  ${state(now.sunLit, 'LIT', 'behind terrain')}  disk ${Math.round(now.sunFraction * 100)}%\n` +
      `earth az ${fmt(earth.az)}° el ${fmt(earth.el)}°  (horizon there ${fmt(maskAt(mask, earth.az))}°)  ${state(now.earthVisible, 'VISIBLE', 'behind terrain')}`;
  };

  // ---- Time: everything that changes when t moves ----
  let monthFrom = -1;
  let month = year;
  const showTime = (next: number) => {
    t = next;
    now = physicsAt(t);
    scene?.setTime({
      sunEnu: now.sunEnu, earthEnu: now.earthEnu, sunRadiusDeg: now.sunR, earthRadiusDeg: now.earthR,
      ...tracksAt(t), sunLit: now.sunLit, earthMarginDeg: now.earthMargin,
    });
    flat.setBodies(now.sun, now.earth);

    const page = timebar.pageFirst;
    if (page !== monthFrom) {
      monthFrom = page;
      month = windowMetrics(series, page, PAGE_SAMPLES, step);
    }
    const last = sampleDate(data.time.start, step, Math.min(page + PAGE_SAMPLES, count) - 1);
    stats.setWindows({
      month, year,
      monthLabel: `${shortDate(sampleDate(data.time.start, step, page))} – ${shortDate(last)}`,
      yearLabel: String(sampleDate(data.time.start, step, 0).getUTCFullYear()),
    });

    const hoursUntil = (e: number | null) => (e === null ? null : (e - t) * step);
    const darkSince = now.sunLit ? t : stateSince(litAt, series.lit, t);
    stats.setNow({
      sunFraction: now.sunFraction,
      sunLit: now.sunLit,
      earthVisible: now.earthVisible,
      earthMarginDeg: now.earthMargin,
      bars: signalBars(now.earthMargin, now.earthR),
      battery: batteryState(now.sunLit, (t - darkSince) * step, !now.sunLit && darkSince === 0),
      sunEventH: hoursUntil(nextChange(litAt, series.lit, t, !now.sunLit)),
      earthEventH: hoursUntil(nextChange(earthAt, series.earth, t, !now.earthVisible)),
      fluxNow: now.flux,
    });
    update();
  };

  const timebar = new TimeBar(document.getElementById('timebar')!, series, data.time.start, step, {
    onTime: showTime,
    onSettle: (s) => setUrlParam('hour', String(Math.round(s * 100) / 100)),
    nextEvent: (kind, from) =>
      kind === 'sunrise' ? nextChange(litAt, series.lit, from, true) : nextChange(earthAt, series.earth, from, true),
    onJump: (kind) => active.setYaw(kind === 'sunrise' ? now.sun.az : now.earth.az),
  });

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
    setUrlParam('view', next);
    update();
  };

  const onLost = () => {
    scene?.setActive(false); // stop drawing and hide the dead canvas
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

  timebar.seek(t, false);
  flat.setYaw(now.sun.az);
  scene?.setYaw(now.sun.az);
  setMode(mode);
}
