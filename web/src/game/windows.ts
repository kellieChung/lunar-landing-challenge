// "Windows": stretches of time at the base with the same Sun / Earth state,
// from the real hourly series (src/physics via env.ts). They are the turns of
// the game: rovers can only be driven while Earth is up, and the base only
// gets power while the Sun is up.

export type WindowKind = 'both' | 'sun' | 'earth' | 'none';

export interface SkyWindow {
  start: number; // first hour (sample index)
  end: number; // first hour after it
  kind: WindowKind;
}

export const MERGE_BELOW_H = 6; // shorter flickers are folded into the window before them

export function kindAt(lit: ArrayLike<number>, earth: ArrayLike<number>, h: number): WindowKind {
  return lit[h] ? (earth[h] ? 'both' : 'sun') : earth[h] ? 'earth' : 'none';
}

/** Split the year into windows; runs shorter than MERGE_BELOW_H join the previous window. */
export function splitWindows(lit: ArrayLike<number>, earth: ArrayLike<number>, mergeBelowH = MERGE_BELOW_H): SkyWindow[] {
  const raw: SkyWindow[] = [];
  for (let h = 0; h < lit.length; h++) {
    const k = kindAt(lit, earth, h);
    const last = raw[raw.length - 1];
    if (last && last.kind === k) last.end = h + 1;
    else raw.push({ start: h, end: h + 1, kind: k });
  }
  const out: SkyWindow[] = [];
  for (const w of raw) {
    const last = out[out.length - 1];
    if (last && (w.end - w.start < mergeBelowH || last.kind === w.kind)) last.end = w.end;
    else out.push({ ...w });
  }
  // A short first window has nothing before it: fold it forward instead.
  if (out.length > 1 && out[0].end - out[0].start < mergeBelowH) {
    out[1].start = out[0].start;
    out.shift();
  }
  return out;
}

/** Index of the window containing hour h. */
export function windowIndexAt(windows: SkyWindow[], h: number): number {
  let lo = 0;
  let hi = windows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (windows[mid].start <= h) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const hasEarth = (k: WindowKind) => k === 'both' || k === 'earth';
export const hasSun = (k: WindowKind) => k === 'both' || k === 'sun';
