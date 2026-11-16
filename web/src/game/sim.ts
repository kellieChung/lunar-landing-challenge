// The game's rules: one call to step() simulates one hourly sample.
// Deterministic and free of DOM / three.js. Everything about the Moon itself
// (sunlight, Earth in view, slopes, ice) arrives through Env, which start.ts
// fills from src/physics and sites.json; the rules never decide those.

import { ELECTROLYSIS_KWH_PER_KG_WATER, H2_PER_KG_WATER, O2_PER_KG_WATER, bakeKwhPerKg, fuelTarget } from './chemistry';
import {
  BATTERY_PACK_KWH, BATTERY_RESERVE, CABLE_REACH_KM, DIG_HOURS, KEEPALIVE_KW, PAD_COSTS_KG, PLANT_MAX_KW, PROSPECT_HOURS,
  SHELTER_KEEPALIVE_FACTOR, SHELTER_KG, ROADS_KG, ROADS_SPEED_FACTOR, OVEN_KG, OVEN_BAKE_FACTOR,
  ROVER_BATTERY_KWH, ROVER_CHARGE_KW, ROVER_KW, ROVER_PARK_KW, ROVER_PAYLOAD_KG, ROVER_RESERVE_KWH, ROVER_SPEED_KMH,
  UNLOAD_HOURS, WAKE_LEVEL,
} from './constants';
import type { Route } from './paths';
import { newRover, type GameState, type Job, type Key, type Rover } from './state';

export interface Env {
  /** Power (kW) one solar tower at this spot makes during hourly sample `hour` (REAL sunlight). */
  solarKw(spot: Key, hour: number): number;
  /** Is Earth above the horizon from this spot at that hour (REAL)? */
  earthVisible(spot: Key, hour: number): boolean;
  route(from: Key, to: Key): Route | null;
  legKm(a: Key, b: Key): number | null;
  distanceKm(a: Key, b: Key): number;
  /** HYPOTHETICAL ice share (0..1) of a spot, or null if it is not a dark spot. */
  iceFraction(spot: Key): number | null;
  /** Is the spot dark all year (REAL)? Solar panels would never work there. */
  isDark(spot: Key): boolean;
  /** Does the floor hold ice by the cold-trap tiers (rich or trace)? */
  isCrater(spot: Key): boolean;
  /**
   * Hours of Earth link left at this spot from `hour` (0 if Earth is down now), as
   * planners see it: the current Sun/Earth window, short flickers merged (windows.ts).
   */
  earthHoursLeft(spot: Key, hour: number): number;
}

export type GameEvent =
  | { type: 'sleep' } | { type: 'wake' }
  | { type: 'prospected'; spot: Key; ice: number }
  | { type: 'delivered'; rover: number }
  | { type: 'milestone'; id: string }
  | { type: 'fuelReady' };

/** What happened in the last simulated hour (for the panel; not saved). */
export interface PowerReport {
  solarKw: number;
  plantKw: number;
  roverKw: number;
  earth: boolean;
}

export const TARGET = fuelTarget();

export type Result = { ok: true } | { ok: false; why: string };
const no = (why: string): Result => ({ ok: false, why });
const OK: Result = { ok: true };

// ---- Player actions -------------------------------------------------------

/** Hours a round trip takes with the Earth link up: driving both ways plus the work there. */
export function tripHours(km: number, kind: Job['kind'], speed = ROVER_SPEED_KMH): number {
  return Math.ceil((2 * km) / speed) + (kind === 'prospect' ? PROSPECT_HOURS : DIG_HOURS) + 1;
}

/** Round-trip energy (kWh) for a job from `from`, or null if there is no drivable route. */
export function tripNeedKWh(env: Env, from: Key, to: Key, kind: Job['kind'], speed = ROVER_SPEED_KMH): number | null {
  const path = env.route(from, to);
  return path ? tripEnergyKWh(path.km, kind === 'prospect' ? PROSPECT_HOURS : DIG_HOURS, speed) : null;
}

/** Craters (or any spots in `targets`) a rover could drive to and back from `spot` on one battery charge. */
export function reachableDark(env: Env, spot: Key, targets: Key[]): Key[] {
  return targets.filter((d) => {
    const need = tripNeedKWh(env, spot, d, PROSPECT_HOURS > DIG_HOURS ? 'prospect' : 'haul');
    return need !== null && need + ROVER_RESERVE_KWH <= ROVER_BATTERY_KWH;
  });
}

export function land(s: GameState, env: Env, spot: Key, craters: Key[]): Result {
  if (s.base) return no('The base has already landed.');
  if (env.isDark(spot)) return no('This spot got no sunlight in all of 2027, so solar panels would never work here.');
  if (env.isCrater(spot)) return no('This is an icy crater floor: the ice is for digging, not for building on.');
  if (reachableDark(env, spot, craters).length === 0) {
    return no('A rover cannot reach any icy crater from here and back on one charge: too far or too steep.');
  }
  s.base = spot;
  s.landedHour = s.hour;
  s.towers = [spot];
  s.rovers = [newRover(1, spot)];
  s.batteryKWh = s.batteryCapKWh;
  return OK;
}

export function tripEnergyKWh(km: number, workHours: number, speed = ROVER_SPEED_KMH): number {
  return ROVER_KW * ((2 * km) / speed + workHours);
}

/** Rover top speed (km/h): faster once packed roads are built. */
export function roverSpeed(s: GameState): number {
  return ROVER_SPEED_KMH * (s.roads ? ROADS_SPEED_FACTOR : 1);
}

export function orderRover(s: GameState, env: Env, roverId: number, job: Job): Result {
  const rover = s.rovers.find((r) => r.id === roverId);
  if (!s.base || !rover) return no('No rover to send.');
  if (s.launchedHour !== null) return no('The mission is over.');
  if (s.asleep) return no('The base is asleep until the Sun comes back.');
  if (!env.earthVisible(s.base, s.hour)) return no('Earth is hidden behind the terrain, so no new orders can arrive. Wait for Earthrise.');
  if (!env.isCrater(job.target)) return no('Ice can only last where sunlight never or barely reaches. Pick a dark crater.');
  if (!env.route(s.base, job.target)) return no('No drivable route: a slope on the way is steeper than the rover can handle.');
  if (job.kind === 'haul' && !s.prospected.includes(job.target)) return no('Prospect this spot first to find out if there is ice.');
  const need = tripNeedKWh(env, s.base, job.target, job.kind, roverSpeed(s))!;
  if (need + ROVER_RESERVE_KWH > ROVER_BATTERY_KWH) {
    return no(`Too far: the round trip needs ${need.toFixed(1)} kWh but a rover battery holds ${ROVER_BATTERY_KWH}. It would be stranded in the dark.`);
  }
  if (rover.phase === 'idle' || rover.phase === 'charging') {
    rover.job = job;
    rover.phase = 'charging';
  } else {
    rover.next = job;
  }
  return OK;
}

// ---- Building with Moon dirt ----------------------------------------------

export type BuildItem = 'pad' | 'shelter' | 'roads' | 'oven';
export type Upgrade = Exclude<BuildItem, 'pad'>;
export const BUILD_ITEMS: BuildItem[] = ['pad', 'shelter', 'roads', 'oven'];
const UPGRADE_KG: Record<Upgrade, number> = { shelter: SHELTER_KG, roads: ROADS_KG, oven: OVEN_KG };
export const isBuilt = (s: GameState, item: BuildItem): boolean => item !== 'pad' && !!s[item];
export type Delivery = 'rover' | 'tower' | 'battery';

/** Moon dirt (kg) the next build of this kind costs, or null if it can't be built now. */
export function buildCost(s: GameState, env: Env, item: BuildItem): number | null {
  if (!s.base || s.launchedHour !== null) return null;
  if (item === 'pad') {
    const n = s.pads ?? 0;
    return PAD_COSTS_KG[n] ?? PAD_COSTS_KG[PAD_COSTS_KG.length - 1] + 300 * (n - PAD_COSTS_KG.length + 1);
  }
  void env;
  return s[item] ? null : UPGRADE_KG[item];
}

export function buy(s: GameState, env: Env, item: BuildItem): Result {
  const cost = buildCost(s, env, item);
  if (cost === null) return no('Already built.');
  if (s.tailingsKg < cost) return no(`Needs ${cost} kg of Moon dirt.`);
  s.tailingsKg -= cost;
  if (item === 'pad') {
    s.pads = (s.pads ?? 0) + 1;
    s.deliveries = (s.deliveries ?? 0) + 1;
  } else s[item] = true;
  return OK;
}

/**
 * Earth lands one item on a waiting pad: a rover (joins the crater work), a
 * solar tower (placed at `spot`) or a battery pack (more storage, arrives charged).
 */
export function deliver(s: GameState, env: Env, kind: Delivery, spot?: Key): Result {
  if (!s.base || (s.deliveries ?? 0) <= 0) return no('Build a landing pad first.');
  if (kind === 'tower') {
    s.towerCredits++;
    const r = placeTower(s, env, spot ?? '');
    if (!r.ok) {
      s.towerCredits--;
      return r;
    }
  } else if (kind === 'battery') {
    s.batteryCapKWh += BATTERY_PACK_KWH;
    s.batteryKWh += BATTERY_PACK_KWH;
  } else s.rovers.push(newRover(Math.max(0, ...s.rovers.map((r) => r.id)) + 1, s.base));
  s.deliveries = (s.deliveries ?? 1) - 1;
  return OK;
}

/** Send the rovers to work at a crater: scout it first if nobody has, then dig there. */
export function chooseCrater(s: GameState, env: Env, target: Key): Result {
  if (!s.base) return no('Land first.');
  if (!env.isCrater(target)) return no('Ice can only last where sunlight never or barely reaches.');
  const need = tripNeedKWh(env, s.base, target, 'prospect', roverSpeed(s));
  if (need === null || need + ROVER_RESERVE_KWH > ROVER_BATTERY_KWH) return no('Too far or too steep for a rover.');
  s.crater = target;
  for (const r of s.rovers) {
    if (r.phase === 'idle' || r.phase === 'charging') {
      r.job = null;
      r.phase = 'idle';
    } else r.next = null; // finish the current trip, then switch
  }
  return OK;
}

/** Idle rovers pick up work at the chosen crater by themselves: one scouts it, then all dig. */
function autoAssign(s: GameState): void {
  const c = s.crater;
  if (!c) return;
  const known = s.prospected.includes(c);
  const scouting = s.rovers.some((r) => r.job?.kind === 'prospect' && r.job.target === c);
  for (const r of s.rovers) {
    if (r.phase !== 'idle' || r.job) continue;
    if (known) r.job = { kind: 'haul', target: c };
    else if (!scouting) r.job = { kind: 'prospect', target: c };
    else continue;
    r.phase = 'charging';
    if (!known) break;
  }
}

export function placeTower(s: GameState, env: Env, spot: Key): Result {
  if (!s.base || s.towerCredits <= 0) return no('No solar tower is waiting to be placed.');
  if (s.towers.includes(spot)) return no('There is already a solar tower here.');
  if (env.isDark(spot)) return no('This spot got no sunlight in all of 2027.');
  if (env.isCrater(spot)) return no('This is an icy crater floor, too dark for a solar tower.');
  if (env.distanceKm(s.base, spot) > CABLE_REACH_KM + 1e-9) return no(`Too far: the power cable reaches ${CABLE_REACH_KM} km from the base.`);
  s.towers.push(spot);
  s.towerCredits--;
  return OK;
}

export function fuelReady(s: GameState): boolean {
  return s.h2Kg >= TARGET.h2Kg && s.o2Kg >= TARGET.o2Kg;
}

export function launch(s: GameState): Result {
  if (s.launchedHour !== null) return no('Already launched.');
  if (!fuelReady(s)) return no('The tanks are not full enough yet.');
  s.launchedHour = s.hour;
  return OK;
}

// ---- One simulated hour ---------------------------------------------------

function milestone(s: GameState, id: string, events: GameEvent[], resupply = false): void {
  if (s.milestones.includes(id)) return;
  s.milestones.push(id);
  if (resupply) s.resupplies++;
  events.push({ type: 'milestone', id });
}

/** Use rover battery energy; never below empty. */
function drain(r: Rover, kWh: number): void {
  r.chargeKWh = Math.max(0, r.chargeKWh - kWh);
}

/** Drive along the route for one hour, using battery per km. True when the rover has arrived. */
function drive(r: Rover, env: Env, speed: number): boolean {
  let driven = 0;
  let left = speed;
  while (left > 0 && r.route.length > 0) {
    const leg = env.legKm(r.at, r.route[0]) ?? 0;
    const need = leg - r.legKm;
    if (left >= need) {
      left -= need;
      driven += need;
      r.at = r.route.shift()!;
      r.legKm = 0;
    } else {
      r.legKm += left;
      driven += left;
      left = 0;
    }
  }
  drain(r, (ROVER_KW * driven) / speed);
  return r.route.length === 0;
}

function stepRover(s: GameState, env: Env, r: Rover, events: GameEvent[], earthNow: boolean): void {
  const base = s.base!;
  // People on Earth drive the rovers: with no Earth link at the base, a rover out
  // in the field parks and waits (heaters on) until the link comes back.
  if (!earthNow && (r.phase === 'out' || r.phase === 'working' || r.phase === 'back')) {
    drain(r, ROVER_PARK_KW);
    return;
  }
  switch (r.phase) {
    case 'out':
      if (drive(r, env, roverSpeed(s))) {
        r.phase = 'working';
        r.workLeftH = r.job!.kind === 'prospect' ? PROSPECT_HOURS : DIG_HOURS;
      }
      break;
    case 'working':
      drain(r, ROVER_KW);
      if (--r.workLeftH > 0) break;
      if (r.job!.kind === 'prospect') {
        if (!s.prospected.includes(r.at)) s.prospected.push(r.at);
        events.push({ type: 'prospected', spot: r.at, ice: env.iceFraction(r.at) ?? 0 });
        milestone(s, 'prospect', events, false);
      } else {
        r.loadKg = ROVER_PAYLOAD_KG;
        r.loadIceKg = ROVER_PAYLOAD_KG * (env.iceFraction(r.at) ?? 0);
      }
      r.phase = 'back';
      r.route = (env.route(r.at, base)?.keys ?? [base]).slice(1);
      r.legKm = 0;
      break;
    case 'back':
      if (drive(r, env, roverSpeed(s))) {
        r.phase = 'unloading';
        r.workLeftH = UNLOAD_HOURS;
      }
      break;
    case 'unloading':
      if (s.asleep || --r.workLeftH > 0) break;
      if (r.loadKg > 0) {
        s.hopperKg += r.loadKg;
        s.hopperIceKg += r.loadIceKg;
        s.iceDeliveredKg = (s.iceDeliveredKg ?? 0) + r.loadIceKg;
        s.trips++;
        events.push({ type: 'delivered', rover: r.id });
        milestone(s, 'regolith', events, false);
      }
      r.loadKg = r.loadIceKg = 0;
      if (r.next !== undefined) {
        r.job = r.next;
        r.next = undefined;
      } else if (r.job?.kind === 'prospect') r.job = null; // one look is enough
      r.phase = r.job ? 'charging' : 'idle';
      break;
    default: // idle, charging: handled with the power budget
      break;
  }
}

/** Simulate hourly sample s.hour and move on to the next. */
export function step(s: GameState, env: Env): { events: GameEvent[]; power: PowerReport } {
  const events: GameEvent[] = [];
  const hour = s.hour;
  const power: PowerReport = { solarKw: 0, plantKw: 0, roverKw: 0, earth: false };
  if (!s.base || s.launchedHour !== null) {
    s.hour++;
    return { events, power };
  }
  power.earth = env.earthVisible(s.base, hour);
  const wasReady = fuelReady(s);

  // 1. Power. One step is one hour, so kW and kWh are the same number here.
  let surplus = 0;
  for (const t of s.towers) surplus += env.solarKw(t, hour);
  power.solarKw = surplus;
  if (s.asleep) {
    s.sleepHours++;
    s.batteryKWh = Math.min(s.batteryCapKWh, s.batteryKWh + surplus);
    surplus = 0;
    if (s.batteryKWh >= WAKE_LEVEL * s.batteryCapKWh) {
      s.asleep = false;
      events.push({ type: 'wake' });
    }
  } else {
    // Keep-alive first: from sunlight, then from the battery.
    const keepAlive = KEEPALIVE_KW * (s.shelter ? SHELTER_KEEPALIVE_FACTOR : 1);
    const fromSun = Math.min(surplus, keepAlive);
    surplus -= fromSun;
    const fromBattery = keepAlive - fromSun;
    if (fromBattery > s.batteryKWh + 1e-9) {
      s.batteryKWh = 0;
      s.asleep = true;
      events.push({ type: 'sleep' });
    } else {
      s.batteryKWh = Math.max(0, s.batteryKWh - fromBattery);
      // Then refill the battery.
      const charge = Math.min(surplus, s.batteryCapKWh - s.batteryKWh);
      s.batteryKWh += charge;
      surplus -= charge;
    }
  }

  // 2. Rovers. Those away from the base keep working on their own batteries.
  autoAssign(s);
  for (const r of s.rovers) {
    if (r.phase === 'idle' && !r.job) { // top up from spare sunlight while waiting
      const top = Math.min(ROVER_CHARGE_KW, ROVER_BATTERY_KWH - r.chargeKWh, s.asleep ? 0 : surplus);
      r.chargeKWh += top;
      surplus -= top;
      power.roverKw += top;
      continue;
    }
    if (r.phase !== 'charging') {
      stepRover(s, env, r, events, power.earth);
      continue;
    }
    if (s.asleep || !r.job) continue;
    const path = env.route(s.base, r.job.target);
    if (!path) { // cannot happen for an accepted order; stay safe
      r.job = null;
      r.phase = 'idle';
      continue;
    }
    const need = tripEnergyKWh(path.km, r.job.kind === 'prospect' ? PROSPECT_HOURS : DIG_HOURS, roverSpeed(s)) + ROVER_RESERVE_KWH;
    const want = Math.max(0, Math.min(ROVER_CHARGE_KW, need - r.chargeKWh));
    const sun = Math.min(want, surplus);
    const spare = Math.max(0, s.batteryKWh - BATTERY_RESERVE * s.batteryCapKWh);
    const batt = Math.min(want - sun, spare);
    surplus -= sun;
    s.batteryKWh -= batt;
    r.chargeKWh += sun + batt;
    power.roverKw += sun + batt;
    // Leave only with enough charge, and only if the trip can finish before Earth sets.
    if (r.chargeKWh >= need - 1e-9 && env.earthHoursLeft(s.base, hour) >= tripHours(path.km, r.job.kind, roverSpeed(s))) {
      r.phase = 'out';
      r.route = path.keys.slice(1);
      r.legKm = 0;
    }
  }

  // 3. Processing plant: runs only on sunlight left over right now.
  if (!s.asleep) {
    let energy = Math.min(surplus, PLANT_MAX_KW);
    // Bake regolith: ice -> water vapour -> water tank; dry regolith is left over.
    if (s.hopperKg > 1e-9 && energy > 0) {
      const share = s.hopperIceKg / s.hopperKg;
      const perKg = bakeKwhPerKg(share) * (s.oven ? OVEN_BAKE_FACTOR : 1);
      const kg = Math.min(s.hopperKg, energy / perKg);
      const water = kg * share;
      s.hopperKg -= kg;
      s.hopperIceKg -= water;
      s.waterKg += water;
      s.tailingsKg += kg - water;
      energy -= kg * perKg;
      power.plantKw += kg * perKg;
      if (s.hopperKg < 1e-9) s.hopperKg = s.hopperIceKg = 0;
    }
    // Electrolysis: water -> hydrogen + oxygen.
    if (s.waterKg > 1e-9 && energy > 1e-9) {
      const kg = Math.min(s.waterKg, energy / ELECTROLYSIS_KWH_PER_KG_WATER);
      s.waterKg -= kg;
      s.h2Kg += kg * H2_PER_KG_WATER;
      s.o2Kg += kg * O2_PER_KG_WATER;
      power.plantKw += kg * ELECTROLYSIS_KWH_PER_KG_WATER;
      if (s.waterKg < 1e-9) s.waterKg = 0;
    }
  }

  if (s.waterKg > 0 || s.h2Kg > 0) milestone(s, 'water', events);
  if (!wasReady && fuelReady(s)) events.push({ type: 'fuelReady' });

  s.hour++;
  return { events, power };
}
