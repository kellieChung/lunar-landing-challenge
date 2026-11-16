// Game sprites from the Sprout Lands packs (built by `npm run skin` into
// assets/ui-sprout/g/, gitignored: the licence forbids redistribution).
// Every sprite is drawn at a whole-number scale (2x, or 4x for a few large
// ones) so one sprite pixel is always a crisp square. Without the pack each
// sprite falls back to a short word, never an emoji.

import frogUrl from './astrofrog.png';

const urls = import.meta.glob('../../assets/ui-sprout/g/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const manifests = import.meta.glob('../../assets/ui-sprout/g/manifest.json', { eager: true, import: 'default' }) as Record<string, Record<string, SpriteInfo>>;

interface SpriteInfo {
  w: number;
  h: number;
  frames: number;
}

const MANIFEST: Record<string, SpriteInfo> = Object.values(manifests)[0] ?? {};
const URL_OF: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url]),
);

/** Is the pack present (any sprite at all)? */
export const HAS_SPRITES = Object.keys(URL_OF).length > 0;

export function has(name: string): boolean {
  return !!URL_OF[name] && !!MANIFEST[name];
}

export function url(name: string): string | null {
  return URL_OF[name] ?? null;
}

export interface SpriteOpts {
  scale?: 2 | 3 | 4;
  /** Text used without the pack, and as the accessible name (omit for decoration). */
  label?: string;
  cls?: string;
  /** Animate through the frames (stepped), looping; seconds per loop. */
  loop?: number;
  /** Show this frame of a strip (0-based) instead of animating. */
  frame?: number;
}

/**
 * A sprite as an element: a fixed-size box with the frame strip as its
 * background. Falls back to `<span class="g-word">label</span>` (or nothing).
 */
export function sprite(name: string, o: SpriteOpts = {}): HTMLElement {
  const info = MANIFEST[name];
  const src = URL_OF[name];
  if (!info || !src) {
    const w = document.createElement('span');
    w.className = `g-word ${o.cls ?? ''}`;
    w.textContent = o.label ?? '';
    if (!o.label) w.hidden = true;
    return w;
  }
  const k = o.scale ?? 2;
  const i = document.createElement('i');
  i.className = `spr ${o.loop && info.frames > 1 ? 'spr-anim' : ''} ${o.cls ?? ''}`;
  i.style.width = `${info.w * k}px`;
  i.style.height = `${info.h * k}px`;
  i.style.backgroundImage = `url("${src}")`;
  i.style.backgroundSize = `${info.w * info.frames * k}px ${info.h * k}px`;
  if (o.frame) i.style.backgroundPositionX = `${-o.frame * info.w * k}px`;
  if (o.loop && info.frames > 1) {
    i.style.setProperty('--spr-end', `${-info.w * info.frames * k}px`);
    i.style.setProperty('--spr-steps', String(info.frames));
    i.style.setProperty('--spr-dur', `${o.loop}s`);
  }
  if (o.label) {
    i.setAttribute('role', 'img');
    i.setAttribute('aria-label', o.label);
    i.title = o.label;
  } else i.setAttribute('aria-hidden', 'true');
  return i;
}

// The skin's own frames (assets/ui-sprout/*.png), shared with Explore.
const skin = import.meta.glob('../../assets/ui-sprout/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const SKIN_URL: Record<string, string> = Object.fromEntries(
  Object.entries(skin).map(([path, u]) => [path.slice(path.lastIndexOf('/') + 1, -4), u]),
);

/**
 * CSS custom properties pointing at sprites (--s-<name>), for 9-slice frames,
 * meters and cursors in game.css. game.css never names a sprite file itself,
 * so the build works without the pack; `.g-sprites` marks that they exist.
 */
export function installSpriteVars(root: HTMLElement): void {
  for (const n of ['dlg', 'dlg-hi', 'plate', 'plate-hover', 'plate-go', 'plate-down', 'tray-slot', 'bubble', 'cursor', 'cursor-hover', 'cursor-down', 'pip-off', 'pip-green', 'pip-red', 'pip-sun', 'pip-blue', 'pip-purple', 'round', 'round-down', 'cont']) {
    const u = URL_OF[n];
    if (u) root.style.setProperty(`--s-${n}`, `url("${u}")`);
  }
  for (const n of ['panel', 'card', 'btn', 'btn-hover', 'btn-pressed', 'btn-on', 'select', 'select-on', 'slot', 'slot-purple']) {
    const u = SKIN_URL[n];
    if (u) root.style.setProperty(`--s-${n}`, `url("${u}")`);
  }
  root.classList.toggle('g-sprites', HAS_SPRITES && !!SKIN_URL.panel);
}

/**
 * The mascot, Astrofrog: one 22 x 21 px frame (committed, our own art) drawn at
 * 3x. Moods are CSS motions on `g-frog` (`mood-talk`, `mood-cheer`, ...).
 */
export function mascot(mood = 'idle', label?: string): HTMLElement {
  const img = document.createElement('img');
  img.src = frogUrl;
  img.width = 66;
  img.height = 63;
  img.className = `g-frog mood-${mood}`;
  img.alt = label ?? '';
  if (!label) img.setAttribute('aria-hidden', 'true');
  return img;
}

/** Change the mascot's mood (its motion). */
export function setMood(el: HTMLElement, mood: string): void {
  el.className = `g-frog mood-${mood}`;
}
