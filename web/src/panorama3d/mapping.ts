// Pure math for the 3D view: site frame <-> three.js, and vertical exaggeration.
//
// Site frame: (e, n, u) = (east, north, up). Azimuth is clockwise from grid
// north toward east. three.js: x = east, y = up, z = -north (camera looks
// down -z by default, so azimuth 0 is straight ahead).
//
// Exaggeration rule (one rule for everything): every height is scaled by k
// around the eye. For a direction that means (e, n, u) -> normalize(e, n, k u),
// so an elevation el is shown at atan(k tan el), azimuth unchanged. Scaling
// heights is a linear map that keeps lines through the eye straight, so the
// scaled terrain mesh, the skyline rings and the Sun all stay in the same
// order they have in the physics; k = 1 is exactly true scale.

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

export function azElToEnu(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * RAD;
  const el = elDeg * RAD;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

export function enuToThree([e, n, u]: Vec3): Vec3 {
  return [e, u, -n];
}

/** Direction (e, n, u) with its height stretched by k, as a unit vector. */
export function exaggerateEnu([e, n, u]: Vec3, k: number): Vec3 {
  const len = Math.hypot(e, n, k * u);
  return [e / len, n / len, (k * u) / len];
}

/** Elevation (deg) at which a true elevation is shown with stretch k. */
export function exaggerateEl(elDeg: number, k: number): number {
  return Math.atan(k * Math.tan(elDeg * RAD)) / RAD;
}

/**
 * Largest stretch k <= kMax for which elevations minEl..maxEl (deg, the whole
 * year's horizon, Sun and Earth) fit in usableDeg of shown elevation. The
 * flat horizon (0) is always included. Mirrors fitVertical in the 2D strip.
 */
export function fitExaggeration3D(minEl: number, maxEl: number, usableDeg: number, kMax: number): number {
  const lo = Math.min(minEl, 0);
  const hi = Math.max(maxEl, 0);
  const span = (k: number) => exaggerateEl(hi, k) - exaggerateEl(lo, k);
  if (span(kMax) <= usableDeg) return kMax;
  if (span(1) >= usableDeg) return 1;
  let a = 1;
  let b = kMax;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (span(m) <= usableDeg) a = m;
    else b = m;
  }
  return a;
}

/** Pitch (deg) that centers the shown range minEl..maxEl in the view. */
export function defaultPitch(minEl: number, maxEl: number, k: number): number {
  return (exaggerateEl(Math.min(minEl, 0), k) + exaggerateEl(Math.max(maxEl, 0), k)) / 2;
}

/** three.js camera rotation (radians, order YXZ) for a view direction. */
export function cameraEuler(yawDeg: number, pitchDeg: number): { x: number; y: number; z: number; order: 'YXZ' } {
  return { x: pitchDeg * RAD, y: -yawDeg * RAD, z: 0, order: 'YXZ' };
}
