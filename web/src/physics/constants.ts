// Physical constants used by the browser. TODO(astronomer): cite each value
// in docs/METHODS.md (IAU 2015 nominal solar radius; IAU mean Earth radius).

export const AU_KM = 149_597_870.7; // same value as python/lunar/ephemeris.py
export const R_SUN_KM = 695_700;
export const R_EARTH_KM = 6371.0;

const DEG = 180 / Math.PI;

/** Angular radius (deg) of the Sun at r_au astronomical units. */
export function sunRadiusDeg(rAu: number): number {
  return Math.asin(R_SUN_KM / (rAu * AU_KM)) * DEG;
}

/** Angular radius (deg) of Earth at r_km kilometres. */
export function earthRadiusDeg(rKm: number): number {
  return Math.asin(R_EARTH_KM / rKm) * DEG;
}
