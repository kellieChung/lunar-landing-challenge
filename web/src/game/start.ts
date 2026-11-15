// Moon Base v3 (game.MD): short runs about Moon ice, decided by looking.
//
// This file only wires things together: the run (run.ts) and the rules
// (sim.ts) on one side; the 3D view, the time bar and the spot map (from the
// site screen) and the game's own screens (ui/) on the other. Everything about
// the Moon comes from src/physics through env.ts.

import './game.css';
import type { GridPoint, GridSummary, SiteData } from '../data/types';
import type { Scene3D, SceneProp } from '../panorama3d/Scene3D';
import { SHORT, SHORT_GAME } from '../tips';
import type { SpotGridHandle, SpotMark } from '../ui/SpotGrid';
import type { TimeBar } from '../ui/TimeBar';
import { craterNames, currentWindow, groundLabel, siteHasMission, spotMetrics, towerGainHours, tripFacts } from './cards';
import { KEEPALIVE_KW, ROVER_BATTERY_KWH, SHELTER_KEEPALIVE_FACTOR } from './constants';
import { buildWorld, type SeriesAt } from './env';
import { GameClock } from './hud/clock';
import { hostsRuns, isUnlocked, loadProgress, rankOf, recordResult, saveProgress, SITE_ORDER, starsToUnlock, totalStars, unlockedCount } from './progress';
import { buildBattery, buildPlant, buildRocket, buildRover, buildSolarTower, type Plant, type Rocket, type SolarTower } from './props';
import {
  affordable, craterOptions, deadlineHour, due, markBuildsSeen, newRun, nightAhead, projectCraterOptions, projectLandOptions,
  projectTowerOptions, record, RUN_DAYS, runDay, towerOptions, type Mods, type Projection, type Run,
} from './run';
import { clearRun, loadRun, saveRun } from './save';
import { choicePoints, ranks, verdict } from './score';
import { dailySeed, newSeed } from './seed';
import { TARGET, buildCost, buy, chooseCrater, deliver, land, launch, step, type GameEvent, type PowerReport } from './sim';
import { keyOf, type Key, type Rover } from './state';
import { Chooser, revealPanel, type ChoiceOption, type RevealRow } from './ui/choose';
import { Comms, type Mood } from './ui/comms';
import { dur, el, kg } from './ui/dom';
import { Hud, SPEEDS, type HudView } from './ui/hud';
import { briefPanel, lockedPanel, menuPanel, Modal, reportPanel } from './ui/panels';
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
    map: () => {
      hud.mapSlot.hidden = !hud.mapSlot.hidden;
      drawRoutes();
    },
    build: (item) => { if (run && buy(run.game, world.env, item).ok) afterBuy(item); },
    togglePlay: () => togglePlay(),
    speed: (h) => { speed = h; slowUntil = -1; sync(); },
  });
  hud.el.append(comms.el);
  hud.mapSlot.append(x.grid.el);
  x.stage.append(hud.el, revealSlot, chooser.el, chooser.bar, modal.el);

  // ---- Who may run the clock ----
  let want = false; // the player wants time to run
  let speed = SPEEDS[0].h;
  let slowUntil = -1;
  let revealing = false;
  let busy = false; // a decision or an animation owns the screen
  const clock = new GameClock(x.timebar, stepH, lastHour);
  const blocked = () => !run || !run.game.base || run.endedHour !== null || busy || revealing || chooser.open || modal.open || comms.blocking;
  const sync = () => {
    const slowed = !!run && run.game.hour < slowUntil;
    const h = slowed ? Math.min(SLOW_H, speed) : speed;
    if (clock.speed !== h) clock.speed = h;
    clock.setPlaying(want && !blocked());
    hud.setClock(clock.isPlaying || (want && !blocked()), speed, slowed);
    screen.classList.toggle('g-calm', !chooser.open && !revealing);
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
    if ((ev.key === ' ' || ev.key === 'Enter') && comms.blocking && tagName !== 'BUTTON') {
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
  const refreshProps = () => {
    if (!x.scene || !run) return;
    const s = run.game;
    const k = here();
    const home = s.rovers.filter((r) => r.at === k && r.phase !== 'out' && r.phase !== 'back');
    const sig = [k, s.base, s.towers.join('|'), home.length, s.launchedHour !== null, s.pads ?? 0].join(';');
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
    home.forEach((_, n) => props.push({ object: buildRover(), azDeg: az + 52 + 9 * n, distM: 26 + 4 * (n % 2) }));
    x.scene.setProps(props);
    if (arrived && s.base === k && !revealing) x.scene.lookAtProps();
    lightProps();
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
    if (hud.mapSlot.hidden || !run) return;
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
      builds: (['pad', 'shelter'] as const).map((item) => {
        const cost = buildCost(s, env, item);
        return { item, cost, can: cost !== null && s.tailingsKg >= cost && !blocked() };
      }),
      deliveries: s.deliveries ?? 0, shelter: !!s.shelter, towers: s.towers.length,
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
    lightProps();
  };

  // ---- Blocking tips: only three in a run's life (game.MD v3 §7) ----
  const holdOnce = async (id: string, text: string, mood: Mood = 'talk') => {
    if (!run || run.blocking.includes(id)) return;
    run.blocking.push(id);
    await comms.hold(text, mood);
  };

  // ---- Decisions ----
  const after = () => {
    pending = [];
    routeTo = null;
    hud.mapSlot.hidden = true;
    busy = false;
    if (run?.game.base && here() !== run.game.base) goTo(run.game.base);
    x.timebar.seek(Math.min(run!.game.hour, lastHour), false);
    if (run) saveRun(run);
    render();
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
        void holdOnce('look', `${SHORT_GAME.look} Is the ice close?`, 'talk');
      },
      chooseLabel: 'Land here',
      choose: () => void doLand(i),
    }));
    chooser.show(`Where will you land at ${siteName}?`, 'Go look at each spot. The cards hide the numbers: the sky and the timeline tell you.', opts,
      { label: 'Pick a different site', onClick: () => exitTo(sitesUrl, false) });
  };

  const doLand = async (i: number) => {
    const r = run!;
    const k = r.landOptions[i];
    comms.say('Running the numbers on all three spots…', 'talk');
    await new Promise((res) => window.setTimeout(res, 30)); // let the line paint before the projection
    const proj = projectLandOptions(r, world);
    if (!land(r.game, env, k, world.craters).ok) {
      comms.say('That spot didn\'t work. Try another.', 'sad');
      showLanding();
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
    hud.mapSlot.hidden = false;
    chooser.show('Which crater will the rovers dig?', 'Ice only lasts where the Sun never or barely reaches. Go look at each floor and the way there.', keys.map((k) => ({
      glyph: 'e-pick',
      title: names.get(k) ?? 'Crater',
      label: `about ${Math.round(tripFacts(world, r.game.base!, k, 'haul').km)} km away`,
      look: () => { routeTo = k; goTo(k); drawRoutes(); },
      chooseLabel: 'Dig here',
      choose: () => void doCrater(keys, keys.indexOf(k)),
    })));
    return true;
  };

  const doCrater = async (keys: Key[], i: number) => {
    const r = run!;
    const proj = projectCraterOptions(r, world, keys);
    chooseCrater(r.game, env, keys[i]);
    record(r, 'crater', proj, i);
    goTo(keys[i]);
    const floors = keys.map((k) => world.floor(k));
    const ice = keys.map((k) => world.ice.get(k) ?? 0);
    const km = keys.map((k) => tripFacts(world, r.game.base!, k, 'haul').km);
    const rk = ranks(proj);
    await showReveal({
      title: 'Crater picked. How the floors compare',
      names: keys.map((k) => names.get(k) ?? 'Crater'),
      picked: i,
      rows: [
        { name: 'Floor sunlit over the year', tag: 'REAL', values: floors.map(share), winners: bestOf(floors, 'low') },
        { name: 'Ice tier', tag: 'RULE', values: keys.map((k) => (world.tier(k) === 'rich' ? 'rich' : 'trace')), winners: bestOf(keys.map((k) => (world.tier(k) === 'rich' ? 1 : 0)), 'high') },
        { name: 'Ice in the dirt', tag: 'HYPOTHETICAL', values: ice.map((v) => `${(v * 100).toFixed(1)}%`), winners: bestOf(ice, 'high') },
        { name: 'Drive', tag: 'REAL', values: km.map((v) => `${v.toFixed(1)} km`), winners: bestOf(km, 'low') },
      ],
      projection: proj.map(projectionText), projWinners: rk.map((v, j) => (v === 0 ? j : -1)).filter((j) => j >= 0),
      points: choicePoints(r.choices[r.choices.length - 1]),
      why: floors[i] === 0
        ? 'Your floor never saw the Sun in 2027: a cold trap, so the ice is rich.'
        : `Your floor saw a sliver of Sun ${share(floors[i])} of the year, so only a trace of ice is left.`,
    });
    after();
  };

  // 3. Builds, deliveries, towers
  const showBuild = () => {
    const r = run!;
    const items = affordable(r, world);
    markBuildsSeen(r, world);
    busy = true;
    sync();
    const opts: ChoiceOption[] = items.map((item) => (item === 'pad'
      ? { glyph: 'crate', title: `Landing pad · ${buildCost(r.game, env, 'pad')} kg`, label: 'Earth lands one crate on it: a rover, a solar tower or a battery pack.', chooseLabel: 'Build the pad', choose: () => { buy(r.game, env, 'pad'); afterBuy('pad'); } }
      : { glyph: 'fire', title: `Shelter · ${buildCost(r.game, env, 'shelter')} kg`, label: `Bury the base under dirt: it needs ${Math.round(100 * (1 - SHELTER_KEEPALIVE_FACTOR))}% less power at night.`, chooseLabel: 'Build the shelter', choose: () => { buy(r.game, env, 'shelter'); afterBuy('shelter'); } }));
    opts.push({ glyph: 'stone', title: 'Keep the dirt', label: 'Save it for something bigger. You can build any time from the tray.', chooseLabel: 'Keep it', choose: () => after() });
    chooser.show('Your dry dirt can build something', `${kg(r.game.tailingsKg)} of dry dirt is piled up next to the plant.`, opts);
  };

  const afterBuy = (item: 'pad' | 'shelter') => {
    if (!run) return;
    if (item === 'shelter') comms.say(SHORT_GAME.shelter, 'happy');
    else comms.say(SHORT_GAME.pad, 'cheer');
    markBuildsSeen(run, world);
    after();
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
    hud.mapSlot.hidden = false;
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
  let launching = false;
  const doLaunch = () => {
    const r = run!;
    launch(r.game);
    busy = true;
    launching = true;
    want = false;
    sync();
    if (r.game.base) goTo(r.game.base);
    comms.say('Tanks full. Three, two, one…', 'cool');
    window.setTimeout(liftOff, 600);
    window.setTimeout(() => endRun(), 4800);
  };
  const liftOff = () => {
    propsKey = '';
    refreshProps();
    const rk = rocket;
    if (!rk || !x.scene) return;
    x.scene.lookAtProps();
    const t0 = performance.now();
    const frame = (ms: number) => {
      const t = (ms - t0) / 1000;
      rk.body.position.y = 1.5 * t * t;
      x.scene?.requestRender();
      if (t < 4) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  const endRun = () => {
    const r = run!;
    if (r.endedHour !== null) return;
    r.endedHour = r.game.hour;
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
    comms.mood(v.stars === 3 ? 'love' : v.stars > 0 ? 'happy' : 'sad');
    modal.show(reportPanel({
      siteName, stars: v.stars, launched: v.launched, days: v.days, sleepHours: v.sleepHours, skySense: v.skySense,
      fillPct: Math.round(100 * Math.min(1, r.game.h2Kg / TARGET.h2Kg, r.game.o2Kg / TARGET.o2Kg)), nearMiss: v.nearMiss, improved,
      unlocked: openedName, rank: rankOf(totalStars(progress)), totalStars: totalStars(progress),
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
  let half = false;
  const onEvents = (events: GameEvent[]) => {
    for (const ev of events) {
      if (ev.type === 'sleep') { comms.say('Battery empty. The base is asleep until the Sun comes back.', 'zzz'); }
      else if (ev.type === 'wake') { comms.say('Sunlight! The base woke up.', 'happy'); }
      else if (ev.type === 'prospected') {
        const tier = world.tier(ev.spot);
        comms.say(`${names.get(ev.spot) ?? 'The crater'}: ${(100 * ev.ice).toFixed(1)}% ice in the dirt (${tier} floor; the amount is made up). Digging starts.`, 'cheer');
      } else if (ev.type === 'delivered') {
        if (firstHaul) { firstHaul = false; comms.say('First load of icy dirt is home. The plant bakes the water out of it with spare sunlight.', 'happy'); }
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
    if (!half && s.h2Kg >= TARGET.h2Kg / 2 && s.o2Kg >= TARGET.o2Kg / 2) {
      half = true;
      comms.say('The capsule is half full.', 'cheer');
    }
  };

  // ---- The rules follow the clock, hour by hour ----
  let lastSave = 0;
  x.onTime = (t) => {
    if (!run || blocked()) return;
    const until = Math.min(Math.floor(t), lastHour);
    let stop = false;
    while (run.game.hour < until && !stop && !blocked()) {
      const out = step(run.game, env);
      power = out.power;
      onEvents(out.events);
      afterStep();
      stop = nextDecision();
    }
    if (stop) {
      x.timebar.seek(Math.min(run.game.hour, lastHour), false);
      sync();
    } else if (run.game.hour >= lastHour) endRun();
    if (run.game.hour - lastSave >= 24) {
      lastSave = run.game.hour;
      saveRun(run);
    }
    sync();
    render();
  };
  x.onMove = () => render();

  // ---- Menu ----
  const openMenu = () => {
    const show = (nodes: Node[]) => modal.show(nodes);
    modal.show(menuPanel({
      log: comms.history(),
      resume: () => modal.close(),
      restart: () => { clearRun(); exitTo(gameUrl(), false); },
      explore: () => exitTo(exploreUrl()),
      sites: () => exitTo(sitesUrl),
      rank: rankOf(totalStars(progress)),
      stars: totalStars(progress),
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
        ? 'Every crater floor in rover reach sees a little Sun during the year, so only traces of ice survive: too little to fill the capsule within the deadline. That comes from the real 2027 sunlight. Great for power, no good for an ice run.'
        : 'Every floor near here sees the Sun more than 5% of the year, so ice can\'t last. That is real: it is one of the sunniest ridges at the pole. Great for power, no good for an ice run.'),
      Object.assign(el('a', 'g-b g-b-go', 'Moon map'), { href: sitesUrl }),
      Object.assign(el('a', 'g-b g-b-plate', 'Explore this site'), { href: exploreUrl() }),
    ], true);
    return;
  }

  const daily = params.get('daily') === '1';
  if (!daily && !isUnlocked(progress, siteId)) {
    modal.show(lockedPanel(siteName, starsToUnlock(progress, siteId), () => exitTo(sitesUrl, false)), true);
    return;
  }

  const begin = (r: Run, resumed: boolean) => {
    run = r;
    applyMods(r.mods);
    refreshNames();
    x.timebar.seek(Math.min(r.game.hour, lastHour), false);
    if (r.game.base) {
      lastKind = currentWindow(world, r.game.base, Math.min(r.game.hour, lastHour)).win.kind;
      half = r.game.h2Kg >= TARGET.h2Kg / 2 && r.game.o2Kg >= TARGET.o2Kg / 2;
      firstHaul = r.game.trips === 0;
      goTo(r.game.base);
      power = { solarKw: 0, plantKw: 0, roverKw: 0, earth: env.earthVisible(r.game.base, r.game.hour) };
    } else goTo(r.landOptions[0]);
    modal.close();
    render();
    if (resumed && r.game.base) comms.say(`Welcome back. Day ${runDay(r)} at ${siteName}.`, 'happy');
    else comms.say(`${siteName}. Three places to land. Let's go and look.`, 'talk');
    if (!nextDecision()) {
      want = true;
      sync();
    }
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

