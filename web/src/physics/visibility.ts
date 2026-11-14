// Visibility from the horizon mask: the only thing that decides "lit" or
// "Earth visible". Renderers show the result, they never compute it.
// TODO(milestone 4): partial Sun disk (9-point sampling), matching Python.

import { maskAt } from '../panorama/geometry';

export interface AzEl {
  az: number; // deg, site frame
  el: number; // deg
}

/** True when a body's center is above the terrain horizon at its azimuth. */
export function bodyAboveHorizon(body: AzEl, mask: number[]): boolean {
  return body.el > maskAt(mask, body.az);
}
