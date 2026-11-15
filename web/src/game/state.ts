// The whole game in one plain object (saved as JSON). No DOM, no three.js.

import { BATTERY_KWH, ROVER_BATTERY_KWH } from './constants';

/** A grid spot, "i,j" (same i, j as the site file and ?pt=). */
export type Key = string;
export const keyOf = (p: { i: number; j: number }): Key => `${p.i},${p.j}`;

export type JobKind = 'prospect' | 'haul';
export interface Job {
  kind: JobKind;
  target: Key;
}

export type RoverPhase = 'idle' | 'charging' | 'out' | 'working' | 'back' | 'unloading';

export interface Rover {
  id: number;
  at: Key; // last spot reached
  phase: RoverPhase;
  job: Job | null;
  next?: Job | null; // order received while away; taken up back at the base
  route: Key[]; // spots still to drive through
  legKm: number; // km already driven toward route[0]
  workLeftH: number;
  chargeKWh: number; // rover battery charge (kWh), 0 .. ROVER_BATTERY_KWH
  loadKg: number;
  loadIceKg: number;
}

export type UpgradeKind = 'rover' | 'tower' | 'battery';

export interface GameState {
  v: 1;
  siteId: string;
  hour: number; // next hourly sample to simulate
  landedHour: number | null;
  base: Key | null;
  towers: Key[];
  towerCredits: number; // solar towers delivered but not placed yet
  batteryKWh: number;
  batteryCapKWh: number;
  asleep: boolean;
  rovers: Rover[];
  prospected: Key[];
  hopperKg: number; // regolith waiting at the plant
  hopperIceKg: number; // ice inside it
  waterKg: number;
  h2Kg: number;
  o2Kg: number;
  tailingsKg: number; // dry regolith left after baking
  bermBuilt: boolean;
  resupplies: number; // upgrade choices waiting
  milestones: string[];
  seenFacts: string[];
  launchedHour: number | null;
  trips: number;
  iceDeliveredKg?: number; // water ice brought to the plant so far
  sleepHours: number;
  tutorialDone?: boolean; // guided steps finished
  tipsSeen?: string[]; // tooltips already shown (src/tips.ts ids)
  skippedTips?: boolean; // "Skip tutorial": no more tooltips this game
  earthLostOnce?: boolean; // Earth has been hidden from the base at least once
  lastPlanWindow?: number; // index of the last window the player planned
  knownAtPlan?: number; // craters known when the player last planned
  missionsDone?: number; // missions already celebrated
  crater?: Key | null; // the crater the rovers work at
  pads?: number; // landing pads built
  deliveries?: number; // pads waiting for Earth to land something on them
  shelter?: boolean; // thermal shelter built
}

export function newGame(siteId: string, hour = 0): GameState {
  return {
    v: 1, siteId, hour, landedHour: null, base: null, towers: [], towerCredits: 0,
    batteryKWh: BATTERY_KWH, batteryCapKWh: BATTERY_KWH, asleep: false, rovers: [], prospected: [],
    hopperKg: 0, hopperIceKg: 0, waterKg: 0, h2Kg: 0, o2Kg: 0, tailingsKg: 0, bermBuilt: false,
    resupplies: 0, milestones: [], seenFacts: [], launchedHour: null, trips: 0, sleepHours: 0,
  };
}

export function newRover(id: number, at: Key): Rover {
  return { id, at, phase: 'idle', job: null, route: [], legKm: 0, workLeftH: 0, chargeKWh: ROVER_BATTERY_KWH, loadKg: 0, loadIceKg: 0 };
}
