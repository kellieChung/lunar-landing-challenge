// Panorama screen for one site: loads the data, works out the physics for the
// current time (moved by the time bar), and shows it in the 3D scene or the
// 2D strip plus the stats panel.

import { loadMastFile, loadSite, loadSiteIndex, loadTerrain } from '../data/load';
import type { GridPoint, MastPoint, SiteData } from '../data/types';
import { Panorama } from '../panorama/Panorama';
import { maskAt, vecToAzEl } from '../panorama/geometry';
import type { PanoramaView } from '../panorama/view';
import { crop, recenter, stitchToCoarse, type Heightmap } from '../panorama3d/heightmap';
import type { Vec3 } from '../panorama3d/mapping';
import { Scene3D } from '../panorama3d/Scene3D';
import { earthRadiusDeg, sunRadiusDeg } from '../physics/constants';
import { earthVisibleAt, nextChange, stateSince, sunLitAt } from '../physics/events';
import { describeOffset, findPoint, pointVectors } from '../physics/grid';
import { fluxWm2, siteSeries, windowMetrics, type SiteSeries } from '../physics/metrics';
import { batteryState, signalBars } from '../physics/status';
import { sampleDate, valueAt, vectorAt, type VectorSeries } from '../physics/time';
import { eclipseShare, LIT_THRESHOLD, marginDeg, sunlitFraction } from '../physics/visibility';
import { seriesCache } from '../game/env';
import type { GameSession } from '../game/start';
import { startExploreTour } from '../ui/exploreTour';
import { BASE_MAST_M, mastControl, mastFromUrl, mastHeights, mastRows, mastSummaries } from '../ui/MastControl';
import { spotGrid } from '../ui/SpotGrid';
import { StatsPanel } from '../ui/StatsPanel';
import { formatUtc, PAGE_SAMPLES, TimeBar } from '../ui/TimeBar';

type Mode = '3d' | '2d';

const TRACK_HOURS = 709; // ~29.5 days: one trip of the Sun around the horizon
const EARTH_RADIUS_FALLBACK_DEG = 0.95; // only for files without earth.r_km (fake data)
const MARGIN_DEG = 0.5;
const NEAR_TERRAIN_HALF_M = 5000; // the 3D view draws 10 x 10 km of ground around the observer
const DETAIL_PATCH_HALF_M = 1500; // and the 3 x 3 km nearest it from the 10 m heightmap
const MOVE_FADE_MS = 140; // dip to black when moving to another grid spot

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

/** ?mode=game: the Moon Base game on top of the same view (default: Explore, the Navigator). */
function gameFromUrl(): boolean {
  return new URLSearchParams(window.location.search).get('mode') === 'game';
}

/** The Explore | Moon Base switch in the nav bar: same site and spot, full reload. */
function wireModeSwitch(game: boolean): void {
  const go = (toGame: boolean) => {
    const params = new URLSearchParams(window.location.search);
    if (toGame) params.set('mode', 'game');
    else params.delete('mode');
    window.location.assign(`${window.location.pathname}?${params.toString().replace('%2C', ',')}`);
  };
  const explore = document.getElementById('mode-explore') as HTMLButtonElement | null;
  const base = document.getElementById('mode-game') as HTMLButtonElement | null;
  explore?.setAttribute('aria-pressed', String(!game));
  base?.setAttribute('aria-pressed', String(game));
  if (explore) explore.onclick = () => game && go(false);
  if (base) base.onclick = () => !game && go(true);
  document.getElementById('pano-screen')?.classList.toggle('game', game);
}

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
  // sites.json holds the full-year numbers for every grid point (the sidebar grid's colors).
  const summaries = loadSiteIndex()
    .then((all) => all.find((s) => s.id === id)?.grid ?? null)
    .catch((err) => { console.error(err); return null; });
  const data = await loadSite(id);
  showBadge(data);
  const game = gameFromUrl();
  wireModeSwitch(game);
  const seriesAt = seriesCache(data); // hourly lit / Earth per grid point, shared with the game

  // Whole heightmaps, loaded once; each spot crops and re-levels its own piece
  // (rendering only). The 10 m one arrives later (3.4 MB); the view opens with
  // the 100 m ground and adds it. A failure only loses that layer.
  const wholeDetail: Promise<Heightmap | null> = data.terrain && data.terrain_detail
    ? loadTerrain(data.terrain_detail).catch((err) => { console.error(err); return null; })
    : Promise.resolve(null);
  let whole: Heightmap | null = null;
  if (data.terrain) {
    try {
      whole = await loadTerrain(data.terrain);
    } catch (err) {
      console.error(err); // the 3D view still works with rings only
    }
  }
  /** The 10 x 10 km of 100 m ground around a grid point, levelled for it. */
  const terrainAround = (p: GridPoint): Heightmap | null =>
    whole && data.terrain ? crop(recenter(whole, p.dx_km * 1000, p.dy_km * 1000, data.terrain.ground_m), NEAR_TERRAIN_HALF_M) : null;
  /** The 3 x 3 km of 10 m ground around a grid point, stitched into its coarse ground. */
  const detailAround = (fine: Heightmap, p: GridPoint, coarse: Heightmap): Heightmap => {
    const pxM = p.dx_km * 1000;
    const pyM = p.dy_km * 1000;
    // Crop first (around the point, in the file's own coordinates), then
    // re-level: only the patch's vertices get processed.
    const around = crop({ ...fine, x0: fine.x0 - pxM, y0: fine.y0 - pyM }, DETAIL_PATCH_HALF_M);
    const patch = recenter({ ...around, x0: around.x0 + pxM, y0: around.y0 + pyM }, pxM, pyM,
      data.terrain_detail!.ground_m);
    return stitchToCoarse(patch, coarse);
  };

  const mastM = data.site.mast_height_m ?? 3;
  const count = data.time.count;
  const step = data.time.step_hours;
  const sunRMax = sunRadiusDeg(Math.min(...data.sun.r_au));
  const earthRMax = data.earth.r_km ? earthRadiusDeg(Math.min(...data.earth.r_km)) : EARTH_RADIUS_FALLBACK_DEG;
  const earthRAt = (t: number) => (data.earth.r_km ? earthRadiusDeg(valueAt(data.earth.r_km, t)) : EARTH_RADIUS_FALLBACK_DEG);

  // Raised masts (every grid point): one file of horizons per height, loaded
  // when that height is first picked; series cached per height and spot.
  const isCenter = (p: GridPoint) => p.dx_km === 0 && p.dy_km === 0;
  const ijKey = (p: { i: number; j: number }) => `${p.i},${p.j}`;
  const mastMasks = new Map<number, Map<string, MastPoint>>();
  const mastLoads = new Map<number, Promise<boolean>>();
  /** Load one height's horizons (once); false if it could not be loaded. */
  const ensureMast = (h: number): Promise<boolean> => {
    if (h === BASE_MAST_M || mastMasks.has(h)) return Promise.resolve(true);
    const file = data.mast?.files[String(h)];
    if (!file) return Promise.resolve(false);
    let p = mastLoads.get(h);
    if (!p) {
      p = loadMastFile(file).then((f) => {
        mastMasks.set(h, new Map(f.points.map((q) => [ijKey(q), q])));
        return true;
      }).catch((err) => { console.error(err); mastLoads.delete(h); return false; });
      mastLoads.set(h, p);
    }
    return p;
  };
  const mastSeries = new Map<string, SiteSeries>();

  /** Everything that depends on which grid point we stand on and the mast height. */
  const spotAt = (point: GridPoint, mastH = BASE_MAST_M) => {
    const raised = mastH > BASE_MAST_M ? mastMasks.get(mastH)?.get(ijKey(point)) : undefined;
    const raisedH = raised ? mastH : mastM;
    const mask = raised?.mask_deg ?? point.mask_deg;
    // Sun/Earth as seen from this point (the file holds them for the site center).
    const sunV = pointVectors(data.sun, point.up_tilt);
    const earthV = pointVectors(data.earth, point.up_tilt);
    // ---- Physics (the only source of lit / visible) ----
    let series = seriesAt(point);
    if (raised) {
      const k = `${raisedH}:${ijKey(point)}`;
      series = mastSeries.get(k) ?? siteSeries(sunV, earthV, mask);
      mastSeries.set(k, series);
    }
    return {
      point, mask, sunV, earthV, series,
      bands: raised?.mask_bands_deg ?? point.mask_bands_deg ?? null,
      mastM: raisedH,
      atCenter: isCenter(point),
      label: describeOffset(point.dx_km, point.dy_km),
      year: windowMetrics(series, 0, count, step),
      litAt: (t: number) => sunLitAt(sunV, mask, t),
      earthAt: (t: number) => earthVisibleAt(earthV, mask, t),
      elRange: elevationRange(sunV.u, earthV.u, mask, sunRMax, earthRMax),
      // Faint background path: where Earth goes over the whole year.
      earthYear: Array.from({ length: count }, (_, i) => vec(earthV, i)) as Vec3[],
    };
  };

  // The grid point we stand on (?pt=i,j; default the site center), and the
  // mast height (?mast=N; never below 3 m; the game always uses 3 m).
  const mastHs = game ? [] : mastHeights(data);
  const startPoint = findPoint(data.grid.points, new URLSearchParams(window.location.search).get('pt'));
  const startMast = mastFromUrl(mastHs);
  let cur = spotAt(startPoint, (await ensureMast(startMast)) ? startMast : BASE_MAST_M);

  /** Everything about one moment t (fractional sample index), at the current spot. */
  const physicsAt = (t: number) => {
    const sunEnu = vectorAt(cur.sunV, t);
    const earthEnu = vectorAt(cur.earthV, t);
    const rAu = valueAt(data.sun.r_au, t);
    const sun = vecToAzEl(...sunEnu);
    const earth = vecToAzEl(...earthEnu);
    const sunFraction = sunlitFraction(...sunEnu, rAu, cur.mask);
    const sunLit = sunFraction >= LIT_THRESHOLD; // same rule as litAt(t)
    const earthMargin = marginDeg(...earthEnu, cur.mask);
    // Share of the Sun not covered by Earth (1 except during an eclipse); scales the power only.
    const eclipse = data.earth.r_km ? eclipseShare(...sunEnu, rAu, ...earthEnu, valueAt(data.earth.r_km, t)) : 1;
    return {
      sunEnu, earthEnu, sun, earth, sunFraction, sunLit, earthMargin, eclipse,
      earthVisible: earthMargin > 0,
      sunR: sunRadiusDeg(rAu),
      earthR: earthRAt(t),
      flux: fluxWm2(rAu, sunFraction, sun.el, eclipse),
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
      sunTrack = track(cur.sunV);
      earthTrack = track(cur.earthV);
    }
    return { sunTrack, earthTrack };
  };

  let t = hourFromUrl(count);
  let now = physicsAt(t);
  const landerAz = now.sun.az - 30; // kept when moving between spots

  // ---- Views ----
  const stage = document.querySelector('#pano-screen .pano-stage') as HTMLElement;
  const canvas2d = document.getElementById('panorama') as HTMLCanvasElement;
  const canvas3d = document.getElementById('pano3d') as HTMLCanvasElement;
  const fallback = document.getElementById('pano3d-fallback')!;
  const btn3d = document.getElementById('mode-3d') as HTMLButtonElement;
  const btn2d = document.getElementById('mode-2d') as HTMLButtonElement;
  const btnTrue = document.getElementById('true-scale') as HTMLButtonElement;
  const readout = document.getElementById('readout')!;
  const statsRoot = document.getElementById('stats')!;
  const stats = new StatsPanel(statsRoot);
  const back = document.getElementById('back-link') as HTMLAnchorElement | null;
  if (back) back.href = `./?focus=${data.site.id}`;
  const spotLabel = document.getElementById('spot-label');

  const flat = new Panorama(canvas2d);
  let scene: Scene3D | null = null;
  try {
    scene = new Scene3D(canvas3d);
  } catch (err) {
    console.error(err);
    scene = null;
    canvas3d.hidden = true;
  }

  let detailToken = 0;
  /** Point the views, labels and URL at the current spot (cur). */
  const showSpot = () => {
    const { point, atCenter, label } = cur;
    if (atCenter) {
      if (new URLSearchParams(window.location.search).has('pt')) setUrlParam('pt', '0,0');
    } else setUrlParam('pt', `${point.i},${point.j}`);
    if (cur.mastM !== mastM || new URLSearchParams(window.location.search).has('mast')) setUrlParam('mast', String(cur.mastM));
    document.title = `${data.site.name}${atCenter ? '' : ` (${label.replace(' of the site center', '')})`} · Lunar Landing Site Navigator`;
    if (spotLabel) {
      const dz = point.ground_m !== undefined && data.site.ground_height_m !== undefined
        ? point.ground_m - data.site.ground_height_m : null;
      const mastNote = cur.mastM !== mastM ? ` · ${cur.mastM} m mast` : '';
      spotLabel.textContent = atCenter ? `${data.site.name} · site center${mastNote}`
        : `${data.site.name} · ${label}${dz === null ? '' : ` · ground ${dz >= 0 ? '+' : '−'}${Math.abs(dz).toFixed(0)} m`}${mastNote}`;
    }

    flat.setMask(cur.mask, cur.bands);
    flat.fitElevations(...cur.elRange);
    if (scene) {
      const terrain = terrainAround(point);
      scene.setSite({ mask: cur.mask, bands: cur.bands, terrain, mastM: cur.mastM, elRange: cur.elRange, earthYear: cur.earthYear, landerAz });
      const token = ++detailToken;
      const s3 = scene;
      if (terrain) {
        void wholeDetail.then((fine) => {
          if (fine && token === detailToken) s3.setDetail(detailAround(fine, point, terrain));
        }).catch((err) => console.error(err));
      }
    }
  };
  showSpot();
  flat.setBodies(now.sun, now.earth);

  let mode: Mode = scene ? modeFromUrl() : '2d';
  let active: PanoramaView = flat;
  let trueScale = false;

  const fmt = (v: number) => v.toFixed(2).padStart(6);
  const state = (yes: boolean, on: string, off: string) => (yes ? on : off);
  const update = () => {
    const { sun, earth } = now;
    const mask = cur.mask;
    readout.textContent =
      `${data.site.name} · ${cur.label} · mast ${cur.mastM} m   ${formatUtc(sampleDate(data.time.start, step, t))} (hour ${t.toFixed(2)})   view ${fmt(active.yaw)}°   ${mode.toUpperCase()}   vertical ×${active.exaggeration.toFixed(1)}\n` +
      `sun   az ${fmt(sun.az)}° el ${fmt(sun.el)}°  (horizon there ${fmt(maskAt(mask, sun.az))}°)  ${state(now.sunLit, 'LIT', 'behind terrain')}  disk ${Math.round(now.sunFraction * 100)}%\n` +
      `earth az ${fmt(earth.az)}° el ${fmt(earth.el)}°  (horizon there ${fmt(maskAt(mask, earth.az))}°)  ${state(now.earthVisible, 'VISIBLE', 'behind terrain')}`;
  };

  // ---- Time: everything that changes when t moves ----
  let monthFrom = -1;
  let month = cur.year;
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
      month = windowMetrics(cur.series, page, PAGE_SAMPLES, step);
    }
    const last = sampleDate(data.time.start, step, Math.min(page + PAGE_SAMPLES, count) - 1);
    stats.setWindows({
      month, year: cur.year,
      monthLabel: `${shortDate(sampleDate(data.time.start, step, page))} – ${shortDate(last)}`,
      yearLabel: String(sampleDate(data.time.start, step, 0).getUTCFullYear()),
    });

    const hoursUntil = (e: number | null) => (e === null ? null : (e - t) * step);
    const darkSince = now.sunLit ? t : stateSince(cur.litAt, cur.series.lit, t);
    stats.setNow({
      sunFraction: now.sunFraction,
      eclipse: now.eclipse,
      sunLit: now.sunLit,
      earthVisible: now.earthVisible,
      earthMarginDeg: now.earthMargin,
      bars: signalBars(now.earthMargin, now.earthR),
      battery: batteryState(now.sunLit, (t - darkSince) * step, !now.sunLit && darkSince === 0),
      sunEventH: hoursUntil(nextChange(cur.litAt, cur.series.lit, t, !now.sunLit)),
      earthEventH: hoursUntil(nextChange(cur.earthAt, cur.series.earth, t, !now.earthVisible)),
      fluxNow: now.flux,
    });
    update();
    session?.onTime?.(t);
  };

  let session: GameSession | null = null;
  const timebar = new TimeBar(document.getElementById('timebar')!, cur.series, data.time.start, step, {
    onTime: showTime,
    onSettle: (s) => setUrlParam('hour', String(Math.round(s * 100) / 100)),
    nextEvent: (kind, from) =>
      kind === 'sunrise' ? nextChange(cur.litAt, cur.series.lit, from, true) : nextChange(cur.earthAt, cur.series.earth, from, true),
    onJump: (kind) => active.setYaw(kind === 'sunrise' ? now.sun.az : now.earth.az),
  });

  // ---- Moving to another grid spot: same time, same view direction; a quick
  // dip to black so the jump reads as a move, not a glitch.
  let moveTimer = 0;
  /** Rebuild everything for a spot and mast height (no fade). */
  const standAt = (point: GridPoint, mastH: number) => {
    cur = spotAt(point, mastH);
    trackFrom = -1;
    monthFrom = -1;
    showSpot();
    timebar.setSeries(cur.series);
    showTime(t);
    mast?.set(cur.mastM, mastRows(data, point.i, point.j));
  };
  /** Moving to another spot: a quick fade; the mast height stays. */
  const moveTo = (point: GridPoint, mastH = cur.mastM) => {
    window.clearTimeout(moveTimer);
    stage.classList.add('moving');
    moveTimer = window.setTimeout(() => {
      standAt(point, mastH);
      session?.onMove?.(point);
      requestAnimationFrame(() => stage.classList.remove('moving'));
    }, MOVE_FADE_MS);
    grid.setCurrent(point);
  };
  /** The mast control: same spot, new height, no fade (smooth while dragging). */
  let wantMast = cur.mastM;
  const pickMast = async (h: number) => {
    wantMast = h;
    if (h === cur.mastM) return;
    if (!mastMasks.has(h) && h !== BASE_MAST_M) mast?.setLoading(h);
    const ok = await ensureMast(h);
    if (wantMast !== h) return; // the slider moved on while this height loaded
    if (!ok) {
      mast?.set(cur.mastM, mastRows(data, cur.point.i, cur.point.j));
      return;
    }
    window.clearTimeout(moveTimer); // a pending move keeps its spot but takes the new height
    standAt(cur.point, h);
    showGrid(h);
  };
  let mast: ReturnType<typeof mastControl> | null = null;

  const gridSummaries = await summaries;
  /** The spot map, colored by the year at mast height h. */
  const makeGrid = (h: number) => spotGrid({
    points: data.grid.points, current: cur.point,
    summaries: gridSummaries && mastSummaries(data, gridSummaries, h),
    onPick: (p) => moveTo(p),
    decorate: game ? (p) => session?.decorate?.(p) ?? null : undefined,
  });
  let grid = makeGrid(cur.mastM);
  let gridShownFor = cur.mastM;
  /** Recolor the spot map for a new height (rebuilt in place; it keeps open/closed). */
  const showGrid = (h: number) => {
    if (game || h === gridShownFor) return;
    gridShownFor = h;
    const next = makeGrid(h);
    grid.el.replaceWith(next.el);
    grid = next;
  };
  if (game) {
    session = {
      data, summaries: gridSummaries, seriesAt, timebar, scene, grid, stage, landerAz,
      side: document.querySelector('#pano-screen .side') as HTMLElement,
      main: document.querySelector('#pano-screen .pano-main') as HTMLElement,
      current: () => cur.point, moveTo: (p) => moveTo(p, BASE_MAST_M),
      onTime: null, onMove: null, decorate: null,
    };
  } else {
    if (mastHs.length > 1) {
      mast = mastControl(mastHs, cur.mastM, mastRows(data, cur.point.i, cur.point.j), (h) => void pickMast(h));
      const nowBox = statsRoot.querySelector('.st-now');
      if (nowBox) nowBox.after(mast.el);
      else statsRoot.prepend(mast.el);
    }
    const gridMore = document.createElement('details');
    gridMore.className = 'more';
    gridMore.innerHTML = '<summary>Pick a spot on the map</summary>';
    gridMore.append(grid.el);
    statsRoot.append(gridMore);
  }

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
  if (session) (await import('../game/start')).startGame(session);
  else {
    const tourBtn = document.getElementById('tour-btn');
    if (tourBtn) tourBtn.onclick = () => startExploreTour(true);
    window.setTimeout(() => startExploreTour(), 400); // first visit only; after the layout settles
  }
}
