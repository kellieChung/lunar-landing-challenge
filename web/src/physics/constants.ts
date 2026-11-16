// Physical constants used by the browser (IAU 2015 nominal solar radius and
// total solar irradiance; IAU mean Earth radius). Same values as the Python.

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

/** Solar power at 1 AU (W/m^2), same as python/lunar/metrics.py. */
export const SOLAR_CONSTANT_W_M2 = 1361.0;
