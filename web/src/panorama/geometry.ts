// Pure geometry helpers for the panorama. Angles are in degrees.
// Azimuth is measured clockwise from grid north (toward east), as in the site frame.

const RAD = Math.PI / 180;

/** Wrap an angle into [0, 360). */
export function wrapDeg(deg: number): number {
  const w = deg % 360;
  return w < 0 ? w + 360 : w;
}

/** Wrap an angle difference into [-180, 180). */
export function wrapSigned(deg: number): number {
  return wrapDeg(deg + 180) - 180;
}

/** Horizon elevation at any azimuth: linear interpolation in the mask, wrapping at 360. */
export function maskAt(mask: number[], azDeg: number): number {
  const n = mask.length;
  const f = (wrapDeg(azDeg) / 360) * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  return mask[i0] * (1 - t) + mask[i1] * t;
}

/** Azimuth and elevation of an (east, north, up) vector. */
export function vecToAzEl(e: number, n: number, u: number): { az: number; el: number } {
  const len = Math.hypot(e, n, u);
  return {
    az: wrapDeg(Math.atan2(e, n) / RAD),
    el: Math.asin(u / len) / RAD,
  };
}

/** Screen x of an azimuth, with the view direction `yaw` at the center of the canvas. */
export function azToX(azDeg: number, yawDeg: number, pxPerDeg: number, width: number): number {
  return width / 2 + wrapSigned(azDeg - yawDeg) * pxPerDeg;
}

/** Azimuth shown at screen x (inverse of azToX). */
export function xToAz(x: number, yawDeg: number, pxPerDeg: number, width: number): number {
  return wrapDeg(yawDeg + (x - width / 2) / pxPerDeg);
}

/** Screen y of an elevation. `pxPerDegV` already includes any vertical exaggeration. */
export function elToY(elDeg: number, horizonY: number, pxPerDegV: number): number {
  return horizonY - elDeg * pxPerDegV;
}

/**
 * Choose the vertical stretch so elevations from minEl to maxEl fit between
 * topPad and (height - bottomPad), never stretching more than maxExaggeration.
 * Returns the stretch and the screen y of the 0 deg (flat) horizon.
 */
export function fitVertical(
  height: number, pxPerDeg: number, minEl: number, maxEl: number,
  maxExaggeration: number, topPad: number, bottomPad: number,
): { exaggeration: number; horizonY: number } {
  const usable = Math.max(height - topPad - bottomPad, 1);
  const span = Math.max(maxEl - minEl, 0.1);
  const exaggeration = Math.max(Math.min(maxExaggeration, usable / (span * pxPerDeg)), 1);
  return { exaggeration, horizonY: topPad + maxEl * pxPerDeg * exaggeration };
}
