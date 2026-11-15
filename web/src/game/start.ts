// Moon Base v3 (game.MD): short runs about Moon ice, decided by looking.
//
// This file only wires things together: the run (run.ts) and the rules
// (sim.ts) on one side; the 3D view, the time bar and the spot map (from the
// site screen) and the game's own screens (ui/) on the other. Everything about
// the Moon comes from src/physics through env.ts.

import './game.css';
import * as THREE from 'three';
import type { GridPoint, GridSummary, SiteData } from '../data/types';
import type { Scene3D, SceneProp } from '../panorama3d/Scene3D';
import { SHORT, SHORT_GAME, STORY, TUTORIAL } from '../tips';
import type { SpotGridHandle, SpotMark } from '../ui/SpotGrid';
import type { TimeBar } from '../ui/TimeBar';
import { craterNames, currentWindow, groundLabel, siteHasMission, spotMetrics, towerGainHours, tripFacts } from './cards';
import { KEEPALIVE_KW, OVEN_BAKE_FACTOR, ROADS_SPEED_FACTOR, ROVER_BATTERY_KWH, SHELTER_KEEPALIVE_FACTOR } from './constants';
import { BUILD_INFO } from './ui/hud';
import { buildWorld, type SeriesAt } from './env';
import { GameClock } from './hud/clock';
import { hostsRuns, isUnlocked, loadProgress, rankOf, recordResult, saveProgress, SITE_ORDER, sitesDone, sitesToUnlock, unlockedCount } from './progress';
import { playLaunch } from './launch';
import { buildBattery, buildPlant, buildRocket, buildRover, buildSolarTower, type Plant, type Rocket, type SolarTower } from './props';
import { bearingDeg, RoverViz, type RoverSight } from './roverViz';
import {
  affordable, craterOptions, deadlineHour, due, markBuildsSeen, newRun, nightAhead, projectCraterOptions, projectLandOptions,
  projectTowerOptions, record, RUN_DAYS, runDay, towerOptions, type Mods, type Projection, type Run,
} from './run';
import { clearRun, loadRun, saveRun } from './save';
import { choicePoints, ranks, verdict } from './score';
import { dailySeed, newSeed } from './seed';
import { BUILD_ITEMS, TARGET, buildCost, buy, isBuilt, type BuildItem, chooseCrater, deliver, land, launch, step, type GameEvent, type PowerReport } from './sim';
import { keyOf, type Key, type Rover } from './state';
import { Chooser, revealPanel, type ChoiceOption, type RevealRow } from './ui/choose';
import { Coach, type CoachStep } from './ui/coach';
import { Comms, metFrog, setMetFrog, type Mood } from './ui/comms';
import { dur, el, kg, reducedMotion } from './ui/dom';
import { Hud, SPEEDS, type HudView } from './ui/hud';
import { briefPanel, lockedPanel, menuPanel, Modal, reportPanel } from './ui/panels';
import { burst, floatLabel } from './ui/juice';
import { sfx } from './ui/sound';
import { playCrash } from './ui/crash';
import { installSpriteVars } from './ui/sprites';
import { hasEarth, type WindowKind } from './windows';
import { darkWhy, whySentence } from './why';

/** What the site screen hands to the game (see screens/site.ts). */
export interface GameSession {
  data: SiteData;
  summaries: GridSummary[] | null;
  seriesAt: SeriesAt;
  timebar: TimeBar;
  scene: Scene3D | null;
  grid: SpotGridHandle;
  stage: HTMLElement; // the 3D view's container
  side: HTMLElement;
  main: HTMLElement;
  landerAz: number;
  current(): GridPoint;
  moveTo(p: GridPoint): void;
  onTime: ((t: number) => void) | null;
  onMove: ((p: GridPoint) => void) | null;
  decorate: ((p: GridPoint) => SpotMark | null) | null;
}

const SLOW_H = 4; // game hours per second around sunsets and Earthsets
const SLOW_SPAN_H = 12;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LETTER = (i: number) => String.fromCharCode(65 + i);
const pct = (v: number) => `${Math.round(v)}%`;
const share = (f: number) => (f === 0 ? 'never' : f < 0.01 ? '< 1%' : `${Math.round(f * 100)}%`);

export async function startGame(x: GameSession): Promise<void> {
  const { data, summaries } = x;
  const siteId = data.site.id;
  const siteName = data.site.name;
  const lastHour = data.time.count - 1;
  const stepH = data.time.step_hours;
  const screen = document.getElementById('pano-screen')!;
  screen.classList.add('game-ready');
  installSpriteVars(screen);
  const params = new URLSearchParams(window.location.search);

  // ---- Screens ----
  let run: Run | null = null;
  const comms = new Comms();
  const chooser = new Chooser();
  const modal = new Modal();
  const revealSlot = el('div', 'g-reveal-slot');
  const hud = new Hud({
    menu: () => openMenu(),
    build: (item) => { if (run && !blocked() && buy(run.game, world.env, item).ok) afterBuy(item); },
    togglePlay: () => togglePlay(),
    speed: (h) => { speed = h; slowUntil = -1; sync(); },
  });
  hud.mapSlot.append(x.grid.el);
  // Mission control sits under the full-screen panels (see game.css) and is suspended while
  // one is up (sync below), so a radio line never lands on top of a menu, a choice or a reveal.
  x.stage.append(hud.el, revealSlot, chooser.el, chooser.bar, modal.el, comms.el);

  // ---- Who may run the clock ----
  let want = false; // the player wants time to run
  let speed = SPEEDS[0].h;
  let slowUntil = -1;
  let revealing = false;
  let busy = false; // a decision or an animation owns the screen
  let launching = false; // the launch cinematic is playing
  const clock = new GameClock(x.timebar, stepH, lastHour);
  const blocked = () => !run || !run.game.base || run.endedHour !== null || busy || revealing || chooser.open || modal.open || comms.blocking;
  const sync = () => {
    const slowed = !!run && run.game.hour < slowUntil;
    const h = slowed ? Math.min(SLOW_H, speed) : speed;
    if (clock.speed !== h) clock.speed = h;
    clock.setPlaying(want && !blocked());
    hud.setClock(clock.isPlaying || (want && !blocked()), speed, slowed);
    screen.classList.toggle('g-calm', !chooser.open && !revealing);
    // One rule for the radio: hidden (and waiting) while anything owns the whole screen.
    comms.suspend(modal.open || chooser.full || revealing || launching);
    if (blocked()) hud.closeTray();
  };
  /** Run `fn` once mission control has nothing left to say, holding the clock meanwhile. */
  const whenQuiet = (fn: () => void) => {
    if (!comms.blocking) { fn(); return; }
    busy = true;
    sync();
    void comms.idle().then(() => { busy = false; fn(); });
  };
  clock.onChange = () => hud.setClock(clock.isPlaying, speed, !!run && run.game.hour < slowUntil);
  modal.onChange = () => sync();
  chooser.onChange = () => sync();
  comms.onBlock = () => sync();
  const togglePlay = () => {
    if (blocked()) return;
    want = !clock.isPlaying;
    sync();
  };
  document.addEventListener('keydown', (ev) => {
    const tagName = (ev.target as HTMLElement | null)?.tagName;
    if (ev.key === 'Escape') { modal.escape(); return; }
    if ((ev.key === ' ' || ev.key === 'Enter') && comms.showing && tagName !== 'BUTTON') {
      ev.preventDefault();
      comms.advance();
      return;
    }
    if (ev.key !== ' ' || tagName === 'BUTTON' || tagName === 'INPUT' || tagName === 'A' || tagName === 'SUMMARY') return;
    ev.preventDefault();
    togglePlay();
  });

  if (!summaries) {
    comms.say('I could not load the map for this site. Please go back and pick another one.', 'sad');
    return;
  }
  const world = buildWorld(data, summaries, x.seriesAt);
  const env = world.env;
  const progress = loadProgress();

  // ---- Leaving: every exit goes through here ----
  let leaving = false;
  const gameUrl = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ site: siteId, mode: 'game', ...extra });
    return `${window.location.pathname}?${p}`;
  };
  const exploreUrl = () => `${window.location.pathname}?site=${siteId}`;
  const sitesUrl = `./?focus=${siteId}`;
  const exitTo = (url: string, keep = true) => {
    leaving = true;
    clock.setPlaying(false);
    if (keep && run && run.endedHour === null && run.game.base) saveRun(run);
    window.location.assign(url);
  };
  document.getElementById('back-link')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    exitTo(sitesUrl);
  });
  const exploreBtn = document.getElementById('mode-explore') as HTMLButtonElement | null;
  if (exploreBtn) exploreBtn.onclick = () => exitTo(exploreUrl());
  // Always-on way out: sits above every panel (brief, chooser, coach, launch), so a stray
  // click into the game never traps the player.
  const quit = el('button', 'g-b g-quit', '\u2190 Explore') as HTMLButtonElement;
  quit.type = 'button';
  quit.title = 'Leave the game and go back to Explore';
  quit.onclick = () => exitTo(exploreUrl());
  document.body.append(quit);
  window.addEventListener('pagehide', () => { if (!leaving && run && run.endedHour === null && run.game.base) saveRun(run); });

  // ---- Where we stand, and the 3D props there (rendering only) ----
  const here = () => keyOf(x.current());
  const point = (k: Key) => world.point(k)!;
  const goTo = (k: Key) => { if (here() !== k) x.moveTo(point(k)); };
  let propsKey = '';
  let tower: SolarTower | null = null;
  let plant: Plant | null = null;
  let rocket: Rocket | null = null;
  let power: PowerReport = { solarKw: 0, plantKw: 0, roverKw: 0, earth: false };
  // ---- The run-up to launch: fuel tiers, a pace estimate, a banner ----
  const fillOf = () => (run ? Math.min(1, run.game.h2Kg / TARGET.h2Kg, run.game.o2Kg / TARGET.o2Kg) : 0);
  const TIERS = [0.5, 0.75, 0.9, 0.99];
  const tierOf = (f: number) => TIERS.filter((t) => f >= t).length;
  let fuelTier = 0;
  let fills: [number, number][] = []; // [hour, fill] over the last few days
  const PACE_SPAN_H = 72;
  /** Hours until full at the recent pace, or null if the tanks are not filling. */
  function fuelEta(): number | null {
    if (fills.length < 2) return null;
    const [h0, f0] = fills[0];
    const [h1, f1] = fills[fills.length - 1];
    if (h1 - h0 < 6 || f1 <= f0) return null;
    return ((1 - f1) * (h1 - h0) * stepH) / (f1 - f0);
  }
  const banner = (text: string) => {
    const b = el('div', 'g-banner', text);
    x.stage.append(b);
    window.setTimeout(() => b.remove(), 2700);
  };
  const etaWords = () => {
    const e = fuelEta();
    return e === null ? '' : e >= 36 ? `${Math.round(e / 24)} days` : `${Math.max(1, Math.round(e))} hours`;
  };
  const refreshProps = () => {
    if (!x.scene || !run) return;
    const s = run.game;
    const k = here();
    const sig = [k, s.base, s.towers.join('|'), s.launchedHour !== null, s.pads ?? 0].join(';');
    if (sig === propsKey) return;
    const arrived = !propsKey.startsWith(`${k};${s.base};`);
    propsKey = sig;
    const az = x.landerAz;
    const props: SceneProp[] = [];
    tower = plant = rocket = null;
    if (s.towers.includes(k)) {
      tower = buildSolarTower();
      props.push({ object: tower.group, azDeg: az - 24, distM: 40 });
    }
    if (s.base === k) {
      plant = buildPlant();
      props.push({ object: plant.group, azDeg: az + 30, distM: 44 });
      props.push({ object: buildBattery(), azDeg: az + 13, distM: 36 });
      if (s.launchedHour === null || launching) {
        rocket = buildRocket((s.pads ?? 0) > 0);
        props.push({ object: rocket.group, azDeg: az - 58, distM: 75 });
      }
    }
    x.scene.setProps(props);
    if (arrived && s.base === k && !revealing) x.scene.lookAtProps();
    lightProps();
  };

  // Rovers drive in and out of view (roverViz.ts) instead of being rebuilt with the buildings.
  if (x.scene) x.scene.fx.few = reducedMotion();
  const rovers = x.scene ? new RoverViz(x.scene, buildRover, (n) => ({ azDeg: x.landerAz + 52 + 9 * n, distM: 26 + 4 * (n % 2) })) : null;
  let roverSpot: Key | null = null;
  /** Bearing from spot k toward the far end of a trip to `other` (the first step of the route). */
  const bearingToward = (k: Key, other: Key | null | undefined): number | null => {
    if (!other || other === k) return null;
    const next = env.route(k, other)?.keys[1] ?? other;
    const a = world.point(k);
    const b = world.point(next);
    return a && b ? bearingDeg(a, b) : null;
  };
  const refreshRovers = () => {
    if (!rovers || !run) return;
    const s = run.game;
    const k = here();
    const snap = roverSpot !== k;
    roverSpot = k;
    const sights: RoverSight[] = s.rovers.map((r) => {
      const present = r.at === k && r.phase !== 'out' && r.phase !== 'back';
      const other = k === s.base ? r.route[r.route.length - 1] ?? r.job?.target : s.base;
      const toward = r.route[0] && (r.phase === 'out' || r.phase === 'back') && r.at === k ? r.route[0] : null;
      const a = toward ? world.point(k) : null;
      const b = toward ? world.point(toward) : null;
      return { present, awayAz: a && b ? bearingDeg(a, b) : bearingToward(k, other) };
    });
    rovers.sync(sights, snap);
  };

  // Ambient life: the plant vent puffs while it works and the clock runs.
  const ventAt = new THREE.Vector3();
  let ventT = 0;
  x.scene?.addTicker((dt) => {
    ventT -= dt;
    if (ventT > 0 || !plant) return;
    ventT = 0.45;
    plant.vent.getWorldPosition(ventAt);
    x.scene!.fx.steam(ventAt);
  }, { lowRate: true, idle: () => !(plant?.working && clock.isPlaying && run?.game.base === here()) });

  // Near full (90%+) the rocket vents boil-off: the pad comes alive before launch.
  const padAt = new THREE.Vector3();
  let padT = 0;
  x.scene?.addTicker((dt) => {
    padT -= dt;
    if (padT > 0 || !rocket) return;
    padT = fuelTier >= 4 ? 0.18 : 0.35;
    rocket.group.getWorldPosition(padAt);
    padAt.y += 4 * x.scene!.exaggeration;
    x.scene!.fx.steam(padAt);
  }, { lowRate: true, idle: () => !(rocket && fuelTier >= 3 && !launching && run?.game.base === here()) });

  /** "+N kg ice" over the hopper when a load comes home (or by the fuel gauge when elsewhere). */
  let lastPop = -Infinity;
  const deliveryPop = (iceKg: number) => {
    const now = performance.now();
    if (now - lastPop < 1200 || !run || iceKg <= 0) return;
    lastPop = now;
    const label = `+${iceKg >= 10 ? Math.round(iceKg) : iceKg.toFixed(1)} kg ice`;
    const stageBox = x.stage.getBoundingClientRect();
    if (plant && x.scene && run.game.base === here()) {
      const at = plant.hopper.getWorldPosition(new THREE.Vector3());
      x.scene.fx.dust(at, { count: 28, speedM: 1.6, sizeM: 0.45 });
      const p = x.scene.projectToScreen(at);
      if (p && p.x > stageBox.left && p.x < stageBox.right && p.y > stageBox.top && p.y < stageBox.bottom) {
        floatLabel(x.stage, p.x - stageBox.left, p.y - stageBox.top - 8, label);
        return;
      }
    }
    const fuel = hud.el.querySelector('.g-fuel');
    if (!fuel) return;
    const f = fuel.getBoundingClientRect();
    floatLabel(x.stage, f.left + f.width / 2 - stageBox.left, f.top - stageBox.top - 4, label);
  };

  /** A little party for things that make the base bigger. */
  let seen: { towers: number; pads: number; ups: number } | null = null;
  const celebrate = () => {
    if (!run) return;
    const s = run.game;
    const now = { towers: s.towers.length, pads: s.pads ?? 0, ups: BUILD_ITEMS.filter((i) => isBuilt(s, i)).length };
    const before = seen;
    seen = now;
    if (!before) return;
    if (now.towers > before.towers) {
      sfx.sparkle();
      if (tower && x.scene && s.towers[s.towers.length - 1] === here()) {
        x.scene.fx.sparkle(tower.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 3.5 * x.scene.exaggeration, 0)), { count: 60 });
      } else {
        const map = hud.mapSlot;
        burst(map, 20);
      }
    }
    if (now.pads > before.pads && rocket && x.scene) {
      sfx.sparkle();
      const at = rocket.group.getWorldPosition(new THREE.Vector3());
      x.scene.fx.blast(at.setY(at.y + 0.3 * x.scene.exaggeration), { count: 90, speedM: 6 });
    }
    if (now.ups > before.ups) {
      sfx.sparkle();
      if (plant && x.scene && s.base === here()) x.scene.fx.dust(plant.group.getWorldPosition(new THREE.Vector3()), { count: 70, speedM: 3, sizeM: 0.8 });
    }
  };

  const lightProps = () => {
    if (!run) return;
    const h = Math.min(run.game.hour, lastHour);
    if (tower) {
      tower.setLit(world.series(here()).lit[h] === 1);
      tower.face((Math.atan2(data.sun.e[h], data.sun.n[h]) * 180) / Math.PI);
    }
    plant?.setWorking(power.plantKw > 0.01);
    plant?.setLevels(run.game.h2Kg / TARGET.h2Kg, run.game.o2Kg / TARGET.o2Kg);
    x.scene?.requestRender();
  };

  // ---- Spot map: letters on squares, routes, rover dots ----
  let pending: Key[] = []; // squares numbered for the choice on show
  let names = new Map<Key, string>();
  const refreshNames = () => { names = run?.game.base ? craterNames(env, run.game.base, world.craters) : new Map(); };
  x.decorate = (p) => {
    const k = keyOf(p);
    const s = run?.game;
    if (s?.base === k) return { text: 'B', cls: 'gm-base', note: 'your base' };
    if (s?.towers.includes(k)) return { text: 'T', cls: 'gm-tower', note: 'solar tower' };
    if (pending.includes(k)) return { text: String(pending.indexOf(k) + 1), cls: 'gm-choice', note: `choice ${pending.indexOf(k) + 1}` };
    if (world.ice.has(k)) {
      const name = names.get(k);
      if (!s?.base) return { text: '', cls: 'gm-dark', note: 'icy crater floor' };
      if (!name) return { text: '', cls: 'gm-dark gm-far', note: 'icy floor, out of rover range' };
      return { text: name.slice(-1), cls: `gm-dark${k === s.crater ? ' gm-current' : ''}`, note: name };
    }
    return null;
  };
  let marksKey = '';
  const refreshMarks = () => {
    const s = run?.game;
    const sig = [s?.base, s?.towers.join('|'), pending.join('|'), names.size, s?.crater].join(';');
    if (sig !== marksKey) {
      marksKey = sig;
      x.grid.refresh();
    }
    drawRoutes();
  };
  const svgNs = 'http://www.w3.org/2000/svg';
  const routes = document.createElementNS(svgNs, 'svg');
  routes.classList.add('g-routes');
  routes.setAttribute('aria-hidden', 'true');
  hud.mapSlot.append(routes);
  let routeTo: Key | null = null;
  const cellCenter = (k: Key, box: DOMRect): [number, number] | null => {
    const a = x.grid.el.querySelector<HTMLElement>(`.sg-cell[href*="pt=${k}&"], .sg-cell[href$="pt=${k}"]`);
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
  };
  const drawRoutes = () => {
    if (!run) return;
    const s = run.game;
    const box = hud.mapSlot.getBoundingClientRect();
    routes.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const parts: string[] = [];
    if (s.base) {
      const targets = new Set(s.rovers.map((r) => r.job?.target).filter(Boolean) as Key[]);
      if (routeTo) targets.add(routeTo);
      for (const t of targets) {
        const route = env.route(s.base, t);
        if (!route) continue;
        const pts = route.keys.map((k) => cellCenter(k, box)).filter(Boolean) as [number, number][];
        parts.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="g-route" />`);
      }
      s.rovers.forEach((r, n) => {
        const a = cellCenter(r.at, box);
        if (!a) return;
        let [px, py] = a;
        const next = r.route[0];
        const leg = next ? env.legKm(r.at, next) : null;
        const b = next ? cellCenter(next, box) : null;
        if (b && leg) {
          const f = Math.min(1, r.legKm / leg);
          px += (b[0] - px) * f;
          py += (b[1] - py) * f;
        } else if (r.at === s.base) {
          px += ((n % 3) - 1) * 6;
          py += Math.floor(n / 3) % 2 ? 6 : -6;
        }
        parts.push(`<rect x="${px - 4}" y="${py - 4}" width="8" height="8" class="g-dot${r.loadKg > 0 ? ' loaded' : ''}" />`);
      });
    }
    routes.innerHTML = parts.join('');
  };
  new ResizeObserver(() => drawRoutes()).observe(hud.mapSlot);

  // ---- HUD view ----
  const roverWord = (r: Rover): { word: string; stuck: boolean } => {
    const s = run!.game;
    const where = r.job ? names.get(r.job.target) ?? 'the crater' : '';
    if (s.asleep && (r.phase === 'charging' || r.phase === 'idle')) return { word: 'parked: base asleep', stuck: true };
    if (!power.earth && (r.phase === 'out' || r.phase === 'back' || r.phase === 'working')) return { word: 'waiting for Earth', stuck: true };
    switch (r.phase) {
      case 'idle': return { word: 'at base', stuck: false };
      case 'charging': return { word: power.earth ? 'charging' : 'charging, no Earth', stuck: !power.earth };
      case 'out': return { word: `driving to ${where}`, stuck: false };
      case 'working': return { word: r.job?.kind === 'prospect' ? 'scouting' : 'digging', stuck: false };
      case 'back': return { word: 'hauling home', stuck: false };
      default: return { word: 'unloading', stuck: false };
    }
  };
  const view = (): HudView => {
    const s = run!.game;
    const h = Math.min(s.hour, lastHour);
    const at = s.base ?? here();
    const d = new Date(Date.parse(data.time.start) + h * stepH * 3600_000);
    return {
      landed: !!s.base,
      day: runDay(run!),
      days: RUN_DAYS,
      date: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, 2027`,
      h2: s.h2Kg / TARGET.h2Kg, o2: s.o2Kg / TARGET.o2Kg, h2Kg: s.h2Kg, o2Kg: s.o2Kg,
      battery: s.batteryKWh / s.batteryCapKWh, batteryKWh: s.batteryKWh,
      sun: world.series(at).lit[h] === 1, asleep: s.asleep, earth: env.earthVisible(at, h),
      rovers: s.rovers.map((r) => ({ id: r.id, charge: r.chargeKWh / ROVER_BATTERY_KWH, ...roverWord(r) })),
      dirtKg: s.tailingsKg,
      builds: BUILD_ITEMS.map((item) => {
        const cost = buildCost(s, env, item);
        return { item, cost, built: isBuilt(s, item), can: cost !== null && s.tailingsKg >= cost && !blocked() };
      }),
      nextCost: BUILD_ITEMS
        .filter((item) => !isBuilt(s, item))
        .map((item) => buildCost(s, env, item))
        .reduce<number | null>((m, c) => (c === null ? m : m === null ? c : Math.min(m, c)), null),
      deliveries: s.deliveries ?? 0, towers: s.towers.length,
      fuelEtaH: fuelEta(),
      sunFlipH: flipIn(world.series(at).lit, h), earthFlipH: flipIn(world.series(at).earth, h),
    };
  };
  /** Hours until an hourly on/off series changes state (REAL), or null if it never does again in the data. */
  const flipIn = (series: ArrayLike<number>, h: number): number | null => {
    for (let k = h + 1; k < series.length; k++) if (series[k] !== series[h]) return k - h;
    return null;
  };
  const restingMood = (): Mood => {
    const s = run!.game;
    if (!s.base) return 'idle';
    if (s.asleep) return 'zzz';
    const k = currentWindow(world, s.base, Math.min(s.hour, lastHour)).win.kind;
    return k === 'both' ? 'happy' : k === 'none' ? 'sad' : 'idle';
  };
  const render = () => {
    if (!run) return;
    hud.update(view());
    comms.mood(restingMood());
    refreshMarks();
    refreshProps();
    refreshRovers();
    celebrate();
    lightProps();
  };

  // ---- Tutorial (first run only): how to read a spot and a crater ----
  const coach = new Coach();
  const q = (sel: string) => () => document.querySelector(sel);
  /** Play a tutorial beat once the panel it points at has been laid out. */
  const coachSoon = (id: string, steps: CoachStep[]) => {
    if (!coach.active || coach.played(id)) return;
    window.setTimeout(() => { if (coach.active) void coach.beat(id, steps); }, 80);
  };
  const looked = new Set<number>();
  const cardLook = (n: number) => () => document.querySelectorAll('.g-chooser .g-card')[n]?.querySelector('button') ?? null;
  const revealRow = (n: number) => () => document.querySelectorAll('.g-reveal-table tr')[n]?.firstElementChild ?? null;

  // ---- Blocking tips: only three in a run's life (game.MD v3 §7) ----
  const holdOnce = async (id: string, text: string, mood: Mood = 'talk', tag?: string) => {
    if (!run || run.blocking.includes(id)) return;
    run.blocking.push(id);
    await comms.hold(text, mood, tag);
  };

  // ---- Decisions ----
  const after = async () => {
    pending = [];
    routeTo = null;
    if (run?.game.base && here() !== run.game.base) goTo(run.game.base);
    x.timebar.seek(Math.min(run!.game.hour, lastHour), false);
    if (run) saveRun(run);
    render();
    await comms.idle(); // the next choice waits until the player has read what was just said
    busy = false;
    if (!nextDecision()) {
      want = true;
      sync();
    }
  };

  const projectionText = (p: Projection) => (p.days === null ? `missed (${Math.round(p.fill * 100)}%)` : `day ${Math.ceil(p.days)}`);
  const bestOf = (vals: number[], better: 'low' | 'high') => {
    const t = better === 'low' ? Math.min(...vals) : Math.max(...vals);
    return vals.map((v, i) => (Math.abs(v - t) < 1e-9 ? i : -1)).filter((i) => i >= 0);
  };

  /** Show a reveal; resolve when the player continues. */
  const showReveal = (spec: Parameters<typeof revealPanel>[0]) => new Promise<void>((resolve) => {
    revealing = true;
    hud.el.classList.add('quiet');
    sync();
    const panel = revealPanel(spec, () => {
      panel.remove();
      revealing = false;
      hud.el.classList.remove('quiet');
      x.stage.classList.remove('g-flash');
      sync();
      resolve();
    });
    revealSlot.replaceChildren(panel);
  });

  // 1. Landing spot
  const showLanding = () => {
    const r = run!;
    busy = true;
    sync();
    pending = r.landOptions;
    refreshMarks();
    const opts: ChoiceOption[] = r.landOptions.map((k, i) => ({
      glyph: 'i-home',
      title: `Spot ${LETTER(i)}`,
      label: `${groundLabel(world, k)} ground`,
      look: () => {
        goTo(k);
        looked.add(i);
        if (!coach.active) { void holdOnce('look', `${SHORT_GAME.look} Is the ice close?`, 'talk', 'look'); return; }
        coachSoon('look', [
          { target: q('.ov-compass'), text: TUTORIAL.compass },
          { target: q('#timebar'), text: TUTORIAL.timeline },
          { target: q('.g-mapbox'), text: TUTORIAL.map },
          {
            target: q('.g-lookbar'), text: TUTORIAL.compare,
            hint: () => `You have looked at ${looked.size} of ${r.landOptions.length} spots.`,
          },
        ]);
      },
      chooseLabel: 'Land here',
      choose: () => void doLand(i),
    }));
    chooser.show(`Where will you land at ${siteName}?`, 'Go look at each spot. The cards hide the numbers: the sky and the timeline tell you.', opts,
      { label: 'Pick a different site', onClick: () => exitTo(sitesUrl, false) });
    coachSoon('firstLook', [{ target: cardLook(0), text: TUTORIAL.firstLook }]);
  };

  const doLand = async (i: number) => {
    const r = run!;
    comms.drop('look'); // the "go look" hint is moot once a spot is picked
    coach.hide();
    const k = r.landOptions[i];
    const proj = projectLandOptions(r, world);
    if (!land(r.game, env, k, world.craters).ok) {
      void comms.say('That spot didn\'t work. Try another.', 'sad').then(showLanding);
      return;
    }
    record(r, 'land', proj, i);
    refreshNames();
    goTo(k);
    const m = r.landOptions.map((o) => spotMetrics(world, o));
    const rows: RevealRow[] = [
      { name: 'Sunlit over the year', tag: 'REAL', values: m.map((v) => pct(v.sun)), winners: bestOf(m.map((v) => v.sun), 'high') },
      { name: 'Earth in view', tag: 'REAL', values: m.map((v) => pct(v.earth)), winners: bestOf(m.map((v) => v.earth), 'high') },
      { name: 'Longest night', tag: 'REAL', values: m.map((v) => dur(v.night)), winners: bestOf(m.map((v) => v.night), 'low') },
      { name: 'Drive to ice', tag: 'REAL', values: m.map((v) => `${v.iceKm.toFixed(1)} km`), winners: bestOf(m.map((v) => v.iceKm), 'low') },
    ];
    const rk = ranks(proj);
    // The ridge flash: the middle of this run's longest dark stretch at the chosen spot.
    const why = darkWhy(data, point(k), world.series(k), r.game.hour, deadlineHour(r));
    let whyText: string | undefined;
    if (why) {
      whyText = whySentence(why, (h) => Math.floor((h - r.game.landedHour!) / 24) + 1);
      x.timebar.seek(why.mid, false);
      x.scene?.setYaw(why.sunAz);
      x.stage.classList.add('g-flash');
    }
    coachSoon('landReveal', [
      { target: q('.g-reveal-table'), text: TUTORIAL.revealRows },
      { target: q('.g-reveal-table tr.g-proj > th'), text: TUTORIAL.revealProj },
      { target: q('.g-reveal .g-why'), text: TUTORIAL.revealWhy },
    ]);
    await showReveal({
      title: 'Landed! Here is what the three spots really had',
      names: r.landOptions.map((_, j) => `Spot ${LETTER(j)}`),
      picked: i, rows, projection: proj.map(projectionText), projWinners: rk.map((v, j) => (v === 0 ? j : -1)).filter((j) => j >= 0),
      points: choicePoints(r.choices[r.choices.length - 1]),
      why: whyText,
      note: r.choices.length === 1
        ? `${why ? `The view shows day ${Math.floor((why.mid - r.game.landedHour!) / 24) + 1}, Sun marker bracketed. ` : ''}Projected launch replays the game on the real sky for each spot; Sky Sense scores how your pick would really turn out.`
        : undefined,
    });
    coach.hide();
    after();
  };

  // 2. Crater
  const showCraters = () => {
    const r = run!;
    const keys = craterOptions(r, world);
    if (keys.length === 0) return false;
    busy = true;
    sync();
    pending = keys;
    refreshMarks();
    drawRoutes();
    const sunLabel = (k: Key) => (world.floor(k) === 0 ? 'floor never sunlit' : `floor sunlit ${share(world.floor(k))} of the year`);
    chooser.show('Which crater will the rovers dig?', 'The more Sun a floor gets, the less ice is left in its dirt, so every load brings home less water. Weigh that against the drive.', keys.map((k) => ({
      glyph: 'e-pick',
      title: names.get(k) ?? 'Crater',
      label: `about ${Math.round(tripFacts(world, r.game.base!, k, 'haul').km)} km away · ${sunLabel(k)}`,
      look: () => {
        routeTo = k; goTo(k); drawRoutes();
        coachSoon('craterLook', [
          { target: q('#timebar'), text: TUTORIAL.craterTimeline },
          { target: q('.g-mapbox'), text: TUTORIAL.craterMap },
        ]);
      },
      chooseLabel: 'Dig here',
      choose: () => void doCrater(keys, keys.indexOf(k)),
    })));
    coachSoon('crater', [{ target: q('.g-chooser .g-sub'), text: TUTORIAL.crater }]);
    return true;
  };

  const doCrater = async (keys: Key[], i: number) => {
    const r = run!;
    comms.drop('look');
    coach.hide();
    const proj = projectCraterOptions(r, world, keys);
    chooseCrater(r.game, env, keys[i]);
    record(r, 'crater', proj, i);
    goTo(keys[i]);
    const floors = keys.map((k) => world.floor(k));
    const ice = keys.map((k) => world.ice.get(k) ?? 0);
    const km = keys.map((k) => tripFacts(world, r.game.base!, k, 'haul').km);
    const rk = ranks(proj);
    coachSoon('craterReveal', [{ target: revealRow(2), text: TUTORIAL.craterReveal }]);
    await showReveal({
      title: 'Crater picked. How the floors compare',
      names: keys.map((k) => names.get(k) ?? 'Crater'),
      picked: i,
      rows: [
        { name: 'Floor sunlit over the year', tag: 'REAL', values: floors.map(share), winners: bestOf(floors, 'low') },
        { name: 'Ice tier', tag: 'RULE', values: keys.map((k) => world.tier(k)), winners: bestOf(keys.map((k) => (world.tier(k) === 'rich' ? 1 : 0)), 'high') },
        { name: 'Ice in the dirt', tag: 'HYPOTHETICAL', values: ice.map((v) => `${(v * 100).toFixed(1)}%`), winners: bestOf(ice, 'high') },
        { name: 'Drive', tag: 'REAL', values: km.map((v) => `${v.toFixed(1)} km`), winners: bestOf(km, 'low') },
      ],
      projection: proj.map(projectionText), projWinners: rk.map((v, j) => (v === 0 ? j : -1)).filter((j) => j >= 0),
      points: choicePoints(r.choices[r.choices.length - 1]),
      why: floors[i] === 0
        ? 'Your floor never saw the Sun in 2027: a cold trap, so the ice is rich.'
        : `Your floor saw Sun ${share(floors[i])} of the year, so less ice survived: each load brings home less water.`,
    });
    if (coach.active) {
      coach.hide();
      coach.finish();
      void comms.say(TUTORIAL.done, 'cheer');
    }
    after();
  };

  // 3. Builds, deliveries, towers
  const BUILD_LABEL: Record<BuildItem, string> = {
    pad: 'Earth lands one crate on it: a rover, a solar tower or a battery pack.',
    shelter: `Pile dirt over the base: it uses ${Math.round(100 * (1 - SHELTER_KEEPALIVE_FACTOR))}% less power at night.`,
    roads: `Pack the dirt into smooth tracks: rovers drive ${ROADS_SPEED_FACTOR}× as fast and use less charge per trip.`,
    oven: `Wrap the ice oven in dirt so less heat leaks out: baking uses ${Math.round(100 * (1 - OVEN_BAKE_FACTOR))}% less power.`,
  };
  const showBuild = () => {
    const r = run!;
    const items = affordable(r, world);
    markBuildsSeen(r, world);
    busy = true;
    sync();
    const opts: ChoiceOption[] = items.map((item) => ({
      glyph: BUILD_INFO[item].glyph,
      title: `${BUILD_INFO[item].name} · ${buildCost(r.game, env, item)} kg`,
      label: BUILD_LABEL[item],
      chooseLabel: `Build ${item === 'pad' ? 'the pad' : 'it'}`,
      choose: () => { buy(r.game, env, item); afterBuy(item); },
    }));
    opts.push({ glyph: 'stone', title: 'Keep the dirt', label: 'Save it for something bigger. Build any time with the Build button next to your dirt.', chooseLabel: 'Keep it', choose: () => { void after(); hud.nudgeBuild(); } });
    chooser.show('Your dry dirt can build something', `${kg(r.game.tailingsKg)} of dry dirt is piled up next to the plant. You don't have to wait for this: press Build in the dock whenever you have enough.`, opts);
  };

  const afterBuy = (item: BuildItem) => {
    if (!run) return;
    comms.say(SHORT_GAME[item], item === 'pad' ? 'cheer' : 'happy');
    markBuildsSeen(run, world);
    void after();
    hud.nudgeBuild(); // show where building lives for next time
  };

  const showDelivery = () => {
    const r = run!;
    busy = true;
    sync();
    chooser.show('A crate is coming down on your pad', 'What should Earth send? Think about what is holding the base back right now.', [
      { glyph: 'e-robot', title: 'A rover', label: 'Digs and hauls more icy dirt. Needs charge and Earth in view.', chooseLabel: 'Send a rover',
        choose: () => { deliver(r.game, env, 'rover'); comms.say(`Rover ${r.game.rovers.length} is down and heading for the crater.`, 'cheer'); after(); } },
      { glyph: 'e-sun', title: 'A solar tower', label: 'More power. You choose where it stands, up to 2 km away.', chooseLabel: 'Send a tower', choose: () => showTowers() },
      { glyph: 'e-gameboy', title: 'A battery pack', label: 'Stores another 2 days of base power for the night.', chooseLabel: 'Send a battery',
        choose: () => { deliver(r.game, env, 'battery'); comms.say('Battery pack connected. The base can sit out longer nights.', 'happy'); after(); } },
    ]);
  };

  const showTowers = () => {
    const r = run!;
    const keys = towerOptions(r, world);
    if (keys.length === 0) {
      deliver(r.game, env, 'rover');
      comms.say('No sunny spot within cable reach, so Earth sent a rover instead.', 'idle');
      after();
      return;
    }
    pending = keys;
    refreshMarks();
    drawRoutes();
    chooser.show('Where should the solar tower stand?', 'A good spot is sunny when your base is dark. Go look and compare the timelines.', keys.map((k, i) => ({
      glyph: 'e-sun',
      title: `Tower spot ${i + 1}`,
      label: `${groundLabel(world, k)} ground, ${env.distanceKm(r.game.base!, k).toFixed(1)} km of cable`,
      look: () => goTo(k),
      chooseLabel: 'Build here',
      choose: () => void doTower(keys, i),
    })));
  };

  const doTower = async (keys: Key[], i: number) => {
    const r = run!;
    comms.drop('look');
    const gain = keys.map((k) => towerGainHours(r.game, world, k, deadlineHour(r)));
    const proj = projectTowerOptions(r, world, keys);
    deliver(r.game, env, 'tower', keys[i]);
    record(r, 'tower', proj, i);
    const rk = ranks(proj);
    await showReveal({
      title: 'Tower up. How the spots compare',
      names: keys.map((_, j) => `Spot ${j + 1}`),
      picked: i,
      rows: [{ name: 'Sunny while the base is dark', tag: 'REAL', values: gain.map((g) => `${Math.round(g)} h`), winners: bestOf(gain, 'high') }],
      projection: proj.map(projectionText), projWinners: rk.map((v, j) => (v === 0 ? j : -1)).filter((j) => j >= 0),
      points: choicePoints(r.choices[r.choices.length - 1]),
      why: 'Two panels whose shadows fall at different times cover each other\'s nights.',
    });
    after();
  };

  // 4. Before a long night
  const prepare = () => {
    const r = run!;
    const n = nightAhead(r, world)!;
    r.nightsSeen.push(n.start);
    slowUntil = n.start + SLOW_SPAN_H;
    const keep = KEEPALIVE_KW * (r.game.shelter ? SHELTER_KEEPALIVE_FACTOR : 1);
    const lasts = r.game.batteryKWh / keep;
    const text = `In ${dur(n.start - r.game.hour)} the Sun sets here for ${dur(n.end - n.start)}. The battery can keep the base alive about ${dur(lasts)}${lasts < n.end - n.start ? ', so it will sleep part of the night' : ''}.`;
    if (!r.blocking.includes('night')) {
      busy = true;
      void holdOnce('night', `${text} When the base sleeps, the rovers park and the plant stops until sunlight returns.`, 'talk').then(() => { busy = false; sync(); });
    } else comms.say(text, 'talk');
    return true;
  };

  // 5. Launch and the end of a run
  const doLaunch = () => {
    comms.drop(); // nothing stale over the go call, the cinematic or the report card
    busy = true;
    want = false;
    sync();
    const r = run!;
    if (r.game.base) goTo(r.game.base);
    banner('GO FOR LAUNCH');
    sfx.tick(true);
    void comms.hold('Tanks FULL! All stations report GO. Commander, the button is yours…', 'love', undefined, { loud: true, next: 'Launch!' })
      .then(() => launchNow());
  };
  const launchNow = () => {
    const r = run!;
    if (r.game.launchedHour !== null) return;
    comms.drop();
    launch(r.game);
    busy = true;
    launching = true;
    want = false;
    sync();
    if (r.game.base) goTo(r.game.base);
    const fuel = hud.el.querySelector('.g-fuel');
    if (fuel) burst(fuel, 40);
    sfx.sparkle();
    window.setTimeout(liftOff, 600); // let the move to the base and the confetti land first
  };
  const liftOff = () => {
    propsKey = '';
    refreshProps();
    refreshRovers();
    const rk = rocket;
    if (!rk || !x.scene) {
      launching = false;
      sync();
      void comms.say('Tanks full. Three, two, one… liftoff!', 'cool').then(() => endRun());
      return;
    }
    playLaunch({ scene: x.scene, rocket: rk, stage: x.stage, root: screen, reduced: reducedMotion(), onDone: () => endRun() });
  };

  const endRun = () => {
    const r = run!;
    if (r.endedHour !== null) return;
    r.endedHour = r.game.hour;
    comms.drop();
    launching = false;
    busy = true;
    want = false;
    sync();
    clearRun();
    const before = unlockedCount(progress);
    const v = verdict(r, world);
    const improved = recordResult(progress, siteId, v);
    saveProgress(progress);
    const nowOpen = unlockedCount(progress);
    const opened = nowOpen > before ? SITE_ORDER[nowOpen - 1] : null;
    const openedName = opened ? (opened === siteId ? siteName : opened.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())) : null;
    comms.mood(v.launched ? 'love' : 'sad');
    modal.show(reportPanel({
      siteName, launched: v.launched, days: v.days, sleepHours: v.sleepHours, skySense: v.skySense,
      fillPct: Math.round(100 * Math.min(1, r.game.h2Kg / TARGET.h2Kg, r.game.o2Kg / TARGET.o2Kg)), nearMiss: v.nearMiss, improved,
      unlocked: openedName, rank: rankOf(sitesDone(progress)), sitesDone: sitesDone(progress), sitesTotal: SITE_ORDER.length,
    },
    () => exitTo(gameUrl(modsParam(r.mods)), false),
    () => exitTo(gameUrl({ seed: r.seed, ...modsParam(r.mods), ...(r.daily ? { daily: '1' } : {}) }), false),
    () => exitTo(sitesUrl, false)), true);
  };

  /** What stops the clock next. */
  function nextDecision(): boolean {
    if (!run) return false;
    if (!run.game.base) { showLanding(); return true; }
    switch (due(run, world)) {
      case 'launch': doLaunch(); return true;
      case 'deadline': endRun(); return true;
      case 'crater': return showCraters();
      case 'delivery': showDelivery(); return true;
      case 'build': showBuild(); return true;
      case 'prepare': prepare(); return false; // a beat, not a stop (the first one holds via comms)
      default: return false;
    }
  }

  // ---- Events from the rules ----
  let lastKind: WindowKind | null = null;
  let firstHaul = true;
  const onEvents = (events: GameEvent[]) => {
    for (const ev of events) {
      if (ev.type === 'sleep') { comms.say('Battery empty. The base is asleep until the Sun comes back.', 'zzz'); }
      else if (ev.type === 'wake') { comms.say('Sunlight! The base woke up.', 'happy'); }
      else if (ev.type === 'prospected') {
        const tier = world.tier(ev.spot);
        comms.say(`${names.get(ev.spot) ?? 'The crater'}: ${(100 * ev.ice).toFixed(1)}% ice in the dirt (${tier} floor; the amount is made up). Digging starts.`, 'cheer');
      } else if (ev.type === 'delivered') {
        if (firstHaul) {
          firstHaul = false;
          comms.say(`First load of icy dirt is home. The plant bakes the water out of it with spare sunlight. ${SHORT_GAME.dirt}`, 'happy');
          hud.nudgeBuild();
        }
      }
    }
  };
  const afterStep = () => {
    const s = run!.game;
    if (!s.base) return;
    const kind = currentWindow(world, s.base, Math.min(s.hour, lastHour)).win.kind;
    if (kind !== lastKind) {
      if (lastKind !== null) {
        if (hasEarth(kind) && !hasEarth(lastKind)) { comms.say('Earth is back in view. Rovers are rolling again.', 'happy'); }
        if (!hasEarth(kind) && hasEarth(lastKind)) { comms.say(SHORT.earthLink, 'sad'); }
        slowUntil = Math.max(slowUntil, s.hour + SLOW_SPAN_H);
      }
      lastKind = kind;
    }
    const f = fillOf();
    fills.push([s.hour, f]);
    while (fills.length > 2 && s.hour - fills[0][0] > PACE_SPAN_H) fills.shift();
    const t = tierOf(f);
    if (t > fuelTier) {
      fuelTier = t;
      const eta = etaWords();
      const fuel = hud.el.querySelector('.g-fuel');
      if (fuel) burst(fuel, t >= 3 ? 40 : 26);
      sfx.sparkle();
      if (t >= 3) {
        slowUntil = Infinity; // no fast-forward past the last stretch
        sfx.tick(true);
      }
      if (f < 1) {
        if (t === 1) comms.say('The tank is half full. Halfway home!', 'cheer');
        else if (t === 2) comms.say(`Three quarters full! The pad crew is waking up the rocket.${eta ? ` At this pace, launch in about ${eta}.` : ''}`, 'cheer');
        else if (t === 3) {
          banner('90% FUELED');
          comms.say(`90% FUELED! The rocket is venting and ready to wake.${eta ? ` About ${eta} to launch.` : ''} Keep the ice coming!`, 'love', undefined, { loud: true, next: 'Go!' });
        } else {
          banner('STAND BY FOR LAUNCH');
          comms.say('99%! Topping off the tanks… all stations, STAND BY FOR LAUNCH!', 'love', undefined, { loud: true, next: 'Standing by!' });
        }
      }
    }
  };

  // ---- The rules follow the clock, hour by hour ----
  let lastSave = 0;
  x.onTime = (t) => {
    if (!run || blocked()) return;
    const until = Math.min(Math.floor(t), lastHour);
    let stop = false;
    while (run.game.hour < until && !stop && !blocked()) {
      const iceBefore = run.game.iceDeliveredKg ?? 0;
      const out = step(run.game, env);
      if (out.events.some((ev) => ev.type === 'delivered')) deliveryPop((run.game.iceDeliveredKg ?? 0) - iceBefore);
      power = out.power;
      onEvents(out.events);
      afterStep();
      if (comms.blocking) {
        // Lines from this hour are read first; the next choice (or the end) opens after.
        whenQuiet(() => { if (!nextDecision()) sync(); });
        stop = true;
      } else stop = nextDecision();
    }
    if (stop || blocked()) {
      x.timebar.seek(Math.min(run.game.hour, lastHour), false);
      sync();
    } else if (run.game.hour >= lastHour) whenQuiet(endRun);
    if (run.game.hour - lastSave >= 24) {
      lastSave = run.game.hour;
      saveRun(run);
    }
    sync();
    render();
  };
  x.onMove = () => render();
  // Dev builds only: a handle for poking at the game from the console.
  if (import.meta.env.DEV) (window as unknown as { moonbase: unknown }).moonbase = { get run() { return run; }, scene: x.scene, landerAz: x.landerAz, launch: () => launchNow(), render };

  // ---- Menu ----
  const openMenu = () => {
    const show = (nodes: Node[]) => modal.show(nodes);
    modal.show(menuPanel({
      log: comms.history(),
      resume: () => modal.close(),
      restart: () => { clearRun(); exitTo(gameUrl(), false); },
      explore: () => exitTo(exploreUrl()),
      sites: () => exitTo(sitesUrl),
      rank: rankOf(sitesDone(progress)),
      progress: `${sitesDone(progress)} of ${SITE_ORDER.length} sites`,
    }, show));
  };

  // ---- Start ----
  x.timebar.setLocked(true);
  const modsParam = (m: Mods): Record<string, string> => {
    const v = `${m.trueScale ? 't' : ''}${m.noTimeline ? 'n' : ''}${m.smallBattery ? 'b' : ''}`;
    return v ? { mods: v } : {};
  };
  const urlMods = (): Mods => {
    const v = params.get('mods') ?? '';
    return { trueScale: v.includes('t'), noTimeline: v.includes('n'), smallBattery: v.includes('b') };
  };
  const applyMods = (m: Mods) => {
    if (m.trueScale) x.scene?.setTrueScale(true);
    screen.classList.toggle('g-no-timeline', !!m.noTimeline);
  };

  if (!hostsRuns(siteId) || world.craters.length === 0) {
    const traces = siteHasMission(summaries) && world.craters.length > 0;
    modal.show([
      el('h2', 'g-h', traces ? `${siteName}: only traces of ice` : `${siteName}: no cold trap in reach`),
      el('p', 'g-lede', traces
        ? 'Every crater floor in rover reach sees a little Sun during the year, so only traces of ice survive: too little to fill your tank before the deadline. That comes from the real 2027 sunlight. Great for power, no good for an ice run.'
        : 'Every floor near here sees the Sun more than 5% of the year, so ice can\'t last. That is real: it is one of the sunniest ridges at the pole. Great for power, no good for an ice run.'),
      Object.assign(el('a', 'g-b g-b-go', 'Moon map'), { href: sitesUrl }),
      Object.assign(el('a', 'g-b g-b-plate', 'Explore this site'), { href: exploreUrl() }),
    ], true);
    return;
  }

  const daily = params.get('daily') === '1';
  if (!daily && !isUnlocked(progress, siteId)) {
    modal.show(lockedPanel(siteName, sitesToUnlock(progress, siteId), () => exitTo(sitesUrl, false)), true);
    return;
  }

  const begin = (r: Run, resumed: boolean) => {
    run = r;
    applyMods(r.mods);
    refreshNames();
    x.timebar.seek(Math.min(r.game.hour, lastHour), false);
    if (r.game.base) {
      lastKind = currentWindow(world, r.game.base, Math.min(r.game.hour, lastHour)).win.kind;
      fuelTier = tierOf(fillOf());
      fills = [];
      if (fuelTier >= 3) slowUntil = Infinity;
      firstHaul = r.game.trips === 0;
      goTo(r.game.base);
      power = { solarKw: 0, plantKw: 0, roverKw: 0, earth: env.earthVisible(r.game.base, r.game.hour) };
    } else goTo(r.landOptions[0]);
    modal.close();
    render();
    // New run: the lander starts high in the sky, coming down hurt (ui/crash.ts).
    const crash = resumed && r.game.base ? null : playCrash(x.scene, x.stage, screen, reducedMotion());
    if (crash) sfx.rumble(1.2);
    const go = async () => {
      if (resumed && r.game.base) await comms.say(STORY.resume(runDay(r), siteName), 'happy');
      else {
        for (const line of STORY.crash) await comms.say(line, 'angry');
        await crash!.land();
        await comms.say(STORY.landed, 'happy');
      }
      if (coach.active && !r.game.base) for (const line of TUTORIAL.intro) await comms.say(line, 'talk');
      if (!nextDecision()) {
        want = true;
        sync();
      }
    };
    // The first time ever, Astrofrog says who it is before anything else.
    if (!metFrog()) {
      void comms.hold('Hi! I\'m Astrofrog, your mission control back on Earth. I\'ll radio you here whenever something happens. Click me or press space to carry on.', 'cheer')
        .then(() => { setMetFrog(); void go(); });
    } else void go();
  };

  const saved = loadRun(siteId);
  const seedParam = params.get('seed');
  const seed = daily ? dailySeed() : seedParam ?? newSeed();
  const fresh = () => newRun(world, seed, urlMods(), daily);
  if (saved && !seedParam && !daily) {
    modal.show(briefPanel({ siteName, daily: false, days: RUN_DAYS, h2Kg: TARGET.h2Kg, o2Kg: TARGET.o2Kg, mods: saved.mods, resumeDay: runDay(saved) },
      () => begin(saved, true),
      [Object.assign(el('button', 'g-b g-b-link', 'Start a new run instead'), { type: 'button', onclick: () => { clearRun(); begin(fresh(), false); } })]), true);
    return;
  }
  const first = fresh();
  goTo(first.landOptions[0]);
  modal.show(briefPanel({ siteName, daily, days: RUN_DAYS, h2Kg: TARGET.h2Kg, o2Kg: TARGET.o2Kg, mods: first.mods }, (mods) => {
    // Modifiers chosen here change the run (battery size), so rebuild it from the same seed.
    const same = JSON.stringify(mods) === JSON.stringify(first.mods);
    begin(same ? first : newRun(world, seed, mods, daily), false);
  }), true);
}

