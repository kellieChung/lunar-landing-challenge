// Display rules for the battery icon and signal bars. These are UI
// metaphors (design choices, documented in docs/METHODS.md), not physics:
// the real numbers they come from are always shown beside them.

export const BATTERY_HOURS = 192; // battery endurance (8 days; team choice, replaces the spec's 72 h default)

export interface Battery {
  level: number; // 0..1
  charging: boolean;
  darkHours: number; // hours since sunset (0 while lit)
  hoursLeft: number; // until empty (BATTERY_HOURS while lit)
  sinceStart: boolean; // dark since the first sample: assumed full at the start of the data
}

/**
 * Simple battery: full and charging whenever the Sun is lit (instant
 * recharge), then drains linearly over BATTERY_HOURS of darkness.
 */
export function batteryState(lit: boolean, darkHours: number, sinceStart: boolean,
  capacityH = BATTERY_HOURS): Battery {
  if (lit) return { level: 1, charging: true, darkHours: 0, hoursLeft: capacityH, sinceStart: false };
  const left = Math.max(0, capacityH - darkHours);
  return { level: left / capacityH, charging: false, darkHours, hoursLeft: left, sinceStart };
}

/**
 * Signal bars 0-4 from how far Earth's center is above the horizon (deg).
 * 0 = hidden ("No service"); 1 = center up but part of the disk still behind
 * terrain (margin <= Earth's radius); then 2 / 3 / 4 for more clearance.
 */
export function signalBars(marginDeg: number, earthRadiusDeg: number): number {
  if (marginDeg <= 0) return 0;
  if (marginDeg <= earthRadiusDeg) return 1;
  if (marginDeg <= 2) return 2;
  if (marginDeg <= 4) return 3;
  return 4;
}
