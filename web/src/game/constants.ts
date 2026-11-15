// Every number the Moon Base game uses, in one place, with where it comes from.
//
// Tags (shown to the player next to each number):
//   REAL          textbook physics / chemistry, or computed by src/physics from LOLA + SPICE
//   ESTIMATE      an engineering value taken from a published source
//   HYPOTHETICAL  a design or amount nobody has measured or flown; a labelled guess
//
// TODO(astronomer): verify every value and source below before submission.
// Nothing here is tuned to make the game easier; change a number only with a source.

export type Tag = 'REAL' | 'ESTIMATE' | 'HYPOTHETICAL';

// ---- Chemistry (REAL) -----------------------------------------------------
/** Standard atomic weights (IUPAC), g/mol. */
export const M_H = 1.008;
export const M_O = 15.999;
/** Standard gravity (m/s^2), exact by definition; used with Isp. */
export const G0 = 9.80665;

// ---- Ice processing -------------------------------------------------------
/**
 * Electricity to split water, per kg of hydrogen made (ESTIMATE).
 * The thermodynamic minimum is 39.4 kWh/kg (hydrogen's higher heating value,
 * 285.8 kJ/mol); real electrolyzers need roughly 50-55.
 */
export const ELECTROLYSIS_KWH_PER_KG_H2 = 53;
export const ELECTROLYSIS_MIN_KWH_PER_KG_H2 = 39.4; // REAL, shown as the limit
/** Heat to turn ice straight into vapour: about 2.8 MJ/kg = 0.78 kWh/kg (ESTIMATE). */
export const SUBLIMATION_KWH_PER_KG_WATER = 0.78;
/** Heat to warm 1 kg of very cold regolith by ~200 K (about 0.7 kJ/kg/K) (ESTIMATE). */
export const REGOLITH_HEAT_KWH_PER_KG = 0.04;

/**
 * Water in the regolith, percent by mass, that LCROSS measured in the plume
 * from Cabeus crater: 5.6 +/- 2.9 (Colaprete et al. 2010, Science 330, 463).
 * The game rolls each dark spot's amount inside this range (HYPOTHETICAL:
 * that measurement is from one impact in one crater, not from our sites).
 */
export const ICE_WT_PCT_MEAN = 5.6;
export const ICE_WT_PCT_SIGMA = 2.9;

// ---- Power ----------------------------------------------------------------
/** One solar tower in full sunlight at 1 AU, Sun-tracking (ESTIMATE: NASA VSAT 10 kW class). */
export const SOLAR_TOWER_KW = 10;
/** Heaters, computer and radio that must stay on (HYPOTHETICAL base design). */
export const KEEPALIVE_KW = 0.25;
/** Battery size: keep-alive power for the Navigator's 192 h battery endurance (see physics/status.ts). */
export const BATTERY_ENDURANCE_H = 192;
export const BATTERY_KWH = KEEPALIVE_KW * BATTERY_ENDURANCE_H; // 48 kWh
/** The base wakes from sleep once the battery is back to this share. */
export const WAKE_LEVEL = 0.1;
/** Rovers only charge from the battery above this share (the rest is kept for the night). */
export const BATTERY_RESERVE = 0.25;
/** Most power the processing plant can use (HYPOTHETICAL plant design). */
export const PLANT_MAX_KW = 10;
/** A power cable from a solar tower to the base can be this long (HYPOTHETICAL). */
export const CABLE_REACH_KM = 2;

// ---- Rover ----------------------------------------------------------------
/** Top speed of NASA's VIPER rover: 20 cm/s = 0.72 km/h (ESTIMATE). */
export const ROVER_SPEED_KMH = 0.72;
/** Steepest slope VIPER was designed to drive (ESTIMATE). Checked between 1 km grid spots. */
export const MAX_SLOPE_DEG = 15;
/**
 * Regolith carried per trip (HYPOTHETICAL). No flown rover has a published
 * figure; NASA's IPEx digging robot is itself a ~30 kg-class machine, and a
 * RASSOR mission study assumed 20 kg of regolith per trip. TODO(astronomer): cite.
 */
export const ROVER_PAYLOAD_KG = 30;
/** Power while driving or digging (HYPOTHETICAL). */
export const ROVER_KW = 0.3;
/**
 * Energy a rover's battery holds (HYPOTHETICAL). A rover only leaves when it
 * has enough for the whole round trip, so a spot farther than one charge
 * allows is out of range.
 */
export const ROVER_BATTERY_KWH = 8;
/** Charge a rover keeps in hand on top of the trip itself (HYPOTHETICAL safety margin). */
export const ROVER_RESERVE_KWH = 0.5;
/** Heaters and radio while a rover is parked away from the base waiting for Earth (HYPOTHETICAL). */
export const ROVER_PARK_KW = 0.05;
/** Charging rate at the base (HYPOTHETICAL). */
export const ROVER_CHARGE_KW = 1;
export const DIG_HOURS = 1;
export const PROSPECT_HOURS = 2;
export const UNLOAD_HOURS = 1;

// ---- Return rocket --------------------------------------------------------
/**
 * Empty mass of the return vehicle: a small robotic sample capsule with its
 * engine (HYPOTHETICAL vehicle; real robotic sample-return stages are of this order).
 */
export const ROCKET_DRY_KG = 150;
/**
 * Speed change from the lunar surface to a path back to Earth (ESTIMATE):
 * about 1.9 km/s to reach low lunar orbit plus about 0.9 km/s to leave it.
 */
export const RETURN_DELTA_V_MS = 2800;
/** Specific impulse of a hydrogen-oxygen upper-stage engine (ESTIMATE, RL10 class). */
export const ISP_S = 450;
/** Oxygen burned per kg of hydrogen (ESTIMATE, RL10 class; water itself splits 7.94 : 1). */
export const MIXTURE_RATIO = 6;


// ---- Building with Moon dirt (the dry regolith left after baking out the ice) ----
// Ideas researchers really propose for regolith; the numbers are HYPOTHETICAL
// game values. TODO(astronomer): check the sources and the wording.

/**
 * Landing pad: a flat, stabilised pad with a regolith berm, so Earth can land
 * new hardware near the base without sandblasting it (Metzger et al.; NASA
 * landing / launch pad concepts). Each pad lets Earth deliver one item.
 */
export const PAD_COSTS_KG = [150, 250, 350, 450, 550, 650];
/**
 * Thermal shelter: base hardware buried under regolith, which holds heat
 * (the "thermal wadi" idea, NASA NIAC). Night heater power is cut by this factor.
 */
export const SHELTER_KG = 250;
export const SHELTER_KEEPALIVE_FACTOR = 0.5;
/**
 * Packed roads: rovers drive on graded, compacted regolith tracks (sintered
 * regolith roads are proposed for lunar bases). Rover speed is multiplied by this.
 */
export const ROADS_KG = 300;
export const ROADS_SPEED_FACTOR = 1.5;
/**
 * Dirt-lined oven: the ice oven wrapped in regolith insulation, so less heat
 * leaks away. Baking energy is multiplied by this.
 */
export const OVEN_KG = 350;
export const OVEN_BAKE_FACTOR = 0.75;
/** Battery pack Earth can land on a pad: one more base battery's worth (HYPOTHETICAL). */
export const BATTERY_PACK_KWH = BATTERY_KWH;

// ---- Game rules (TUNE: design values, not physics; see game.MD v3) ---------

/**
 * Cold-trap tiers. A floor whose mean sunlit share over 2027 is 0 is "rich";
 * above 0 up to this share it holds a "trace" that shrinks linearly to nothing
 * at the cut-off; sunnier floors hold none. The rule follows the cold-trap idea;
 * the cut-off is a game choice.
 */
export const TRACE_MAX_SUNLIT = 0.05;
/** A run must launch within this many hours of landing: 3 Sun circuits (synodic month 708.7 h). */
export const RUN_DEADLINE_H = 2124;
/** Most hours the base may sleep in a run and still earn the "Lights on" star. */
export const LIGHTS_ON_MAX_SLEEP_H = 48;
/** Sky Sense points for the 1st, 2nd and 3rd best option of a look-and-compare. */
export const SKY_SENSE_POINTS = [100, 60, 20];
/** Average Sky Sense needed for the third star. */
export const SKY_SENSE_STAR = 80;
/** A dark stretch at the base at least this long gets a "Prepare" beat beforehand. */
export const PREPARE_MIN_NIGHT_H = 48;
export const PREPARE_LEAD_H = 24;
