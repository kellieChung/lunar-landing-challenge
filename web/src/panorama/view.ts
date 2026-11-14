// What the site screen needs from a panorama renderer (2D strip or 3D scene),
// so it can switch between them and keep the view direction.

export interface PanoramaView {
  /** View direction (deg azimuth, site frame) at the center of the screen. */
  readonly yaw: number;
  setYaw(deg: number): void;
  /** Current vertical stretch (1 = true scale). */
  readonly exaggeration: number;
  /** Called after the view direction, size or stretch changes. */
  onChange: (() => void) | null;
  /** Show and draw (true) or hide (false). */
  setActive(on: boolean): void;
  /** True scale (stretch 1) or the default fitted stretch. */
  setTrueScale(on: boolean): void;
}
