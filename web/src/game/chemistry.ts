// Water -> hydrogen + oxygen, and how much propellant the return rocket needs.
// Pure functions of the cited numbers in constants.ts.

import {
  ELECTROLYSIS_KWH_PER_KG_H2, G0, ISP_S, M_H, M_O, MIXTURE_RATIO, REGOLITH_HEAT_KWH_PER_KG, RETURN_DELTA_V_MS,
  ROCKET_DRY_KG, SUBLIMATION_KWH_PER_KG_WATER,
} from './constants';

const M_WATER = 2 * M_H + M_O;
/** Share of water's mass that is hydrogen (about 0.112) and oxygen (about 0.888). */
export const H2_PER_KG_WATER = (2 * M_H) / M_WATER;
export const O2_PER_KG_WATER = M_O / M_WATER;

/** Electricity (kWh) to split 1 kg of water. */
export const ELECTROLYSIS_KWH_PER_KG_WATER = ELECTROLYSIS_KWH_PER_KG_H2 * H2_PER_KG_WATER;

/** Heat (kWh) to bake the water out of 1 kg of regolith holding iceFraction (0..1) of ice. */
export function bakeKwhPerKg(iceFraction: number): number {
  return REGOLITH_HEAT_KWH_PER_KG + iceFraction * SUBLIMATION_KWH_PER_KG_WATER;
}

/** Tsiolkovsky rocket equation: propellant (kg) to give dryKg a speed change of deltaV (m/s). */
export function propellantKg(dryKg: number, deltaVMs: number, ispS: number): number {
  return dryKg * (Math.exp(deltaVMs / (ispS * G0)) - 1);
}

export interface FuelTarget {
  propellantKg: number;
  h2Kg: number;
  o2Kg: number;
  waterKg: number; // water that must be split to get the hydrogen
  spareO2Kg: number; // oxygen left over from that water
}

/** What the return rocket needs, from the constants. */
export function fuelTarget(dryKg = ROCKET_DRY_KG, deltaVMs = RETURN_DELTA_V_MS, ispS = ISP_S,
  mixture = MIXTURE_RATIO): FuelTarget {
  const prop = propellantKg(dryKg, deltaVMs, ispS);
  const h2Kg = prop / (1 + mixture);
  const o2Kg = prop - h2Kg;
  const waterKg = h2Kg / H2_PER_KG_WATER;
  return { propellantKg: prop, h2Kg, o2Kg, waterKg, spareO2Kg: waterKg * O2_PER_KG_WATER - o2Kg };
}
