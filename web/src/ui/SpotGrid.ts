// "Your spot" section at the top of the panorama sidebar: the site's 11 x 11
// grid (1 km apart, north up, east right) as small squares colored by how much
// of 2027 each spot is in sunlight. Hover or focus a square for its numbers;
// click it to stand there (the panorama swaps in place, same time and view).
// Each square is also a link to that spot, so it can open in a new tab.
//
// The numbers come from sites.json (Python, horizon-mask physics); nothing
// here decides lit or visible.

import type { GridPoint, GridSummary } from '../data/types';
import { describeOffset } from '../physics/grid';

// Sunlit share color scale (inferno-like, ending in the app's Sun gold),
// fixed 0-100% so sites compare fairly. The low end is spread out because
// most spots near the pole are lit well under half the time.
const STOPS: [number, [number, number, number]][] = [
  [0, [0x10, 0x12, 0x18]],
  [12, [0x3b, 0x24, 0x66]],
  [30, [0x9c, 0x2f, 0x63]],
  [50, [0xe0, 0x60, 0x3a]],
  [75, [0xff, 0xc8, 0x45]],
  [100, [0xff, 0xf2, 0xb8]],
];

const rgb = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v)).join(', ')})`;

/** CSS color for a % sunlit value (0-100). */
export function sunlitColor(pct: number): string {
  const v = Math.min(100, Math.max(0, pct));
  for (let k = 1; k < STOPS.length; k++) {
    const [p1, c1] = STOPS[k];
    if (v <= p1) {
      const [p0, c0] = STOPS[k - 1];
      const f = (v - p0) / (p1 - p0);
      return rgb(c0.map((a, n) => a + (c1[n] - a) * f));
    }
  }
  return rgb(STOPS[STOPS.length - 1][1]);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** URL of the same page at grid point (i, j), keeping ?hour and ?view. */
function spotUrl(i: number, j: number): string {
  const params = new URLSearchParams(window.location.search);
  params.set('pt', `${i},${j}`);
  return `${window.location.pathname}?${params.toString().replace('%2C', ',')}`;
}

export interface SpotGridOptions {
  points: GridPoint[]; // from the site file (positions)
  current: GridPoint; // where we stand now
  summaries: GridSummary[] | null; // from sites.json (colors and numbers); null = uncolored
  onPick: (p: GridPoint) => void; // a square was clicked (not the current one)
  /** Game mode: a short mark, extra class names and a note for a square (see refresh). */
  decorate?: (p: GridPoint) => SpotMark | null;
}

export interface SpotMark {
  text?: string; // one or two characters drawn on the square
  cls?: string; // extra class names
  note?: string; // added to the readout line
}

export interface SpotGridHandle {
  el: HTMLElement;
  /** Move the "you are here" outline (after onPick, once the view has moved). */
  setCurrent(p: GridPoint): void;
  /** Redraw the marks from `decorate` (game mode). */
  refresh(): void;
}

/** Build the "Your spot" sidebar section. */
export function spotGrid(opts: SpotGridOptions): SpotGridHandle {
  const { points, summaries, onPick } = opts;
  let current = opts.current;
  const key = (p: { i: number; j: number }) => `${p.i},${p.j}`;
  const summary = new Map((summaries ?? []).map((s) => [key(s), s]));
  const centerSummary = summaries?.find((s) => s.dx_km === 0 && s.dy_km === 0);
  const centerPoint = points.find((p) => p.dx_km === 0 && p.dy_km === 0);
  const groundOf = (p: GridPoint) => summary.get(key(p))?.ground_m ?? p.ground_m;
  const center0 = centerSummary?.ground_m ?? centerPoint?.ground_m;

  const xs = [...new Set(points.map((p) => p.dx_km))].sort((a, b) => a - b);
  const ys = [...new Set(points.map((p) => p.dy_km))].sort((a, b) => b - a); // north on top

  const section = el('section', 'spot-grid');
  section.setAttribute('aria-label', 'Choose your spot');
  section.append(el('h3', 'st-h', 'Your spot · 1 km grid'));

  const describe = (p: GridPoint) => {
    const where = describeOffset(p.dx_km, p.dy_km);
    const g = groundOf(p);
    const dz = g !== undefined && center0 !== undefined ? g - center0 : null;
    const ground = dz === null || (p.dx_km === 0 && p.dy_km === 0) ? ''
      : ` · ground ${dz >= 0 ? '+' : '−'}${Math.abs(dz).toFixed(0)} m`;
    const s = summary.get(key(p));
    const nums = s
      ? `${s.sunlit_pct.toFixed(0)}% sunlit · Earth ${s.earth_pct.toFixed(0)}% · longest night ${(s.longest_dark_h / 24).toFixed(1)} d`
      : '';
    const note = opts.decorate?.(p)?.note;
    return { where: where + ground, nums: note ? `${nums}${nums ? ' · ' : ''}${note}` : nums };
  };

  const wrap = el('div', 'sg-wrap');
  const board = el('div', 'sg-board');
  board.style.gridTemplateColumns = `repeat(${xs.length}, 1fr)`;
  const readWhere = el('div', 'sg-where');
  const readNums = el('div', 'sg-nums');
  const show = (p: GridPoint, here: boolean) => {
    const d = describe(p);
    readWhere.textContent = `${here ? 'Here: ' : ''}${d.where}`;
    readNums.textContent = d.nums;
  };
  const showCurrent = () => show(current, true);
  const isHere = (p: GridPoint) => p.i === current.i && p.j === current.j;
  const cells = new Map<string, HTMLAnchorElement>();

  const byPos = new Map(points.map((p) => [`${p.dx_km},${p.dy_km}`, p]));
  for (const y of ys) {
    for (const x of xs) {
      const p = byPos.get(`${x},${y}`);
      if (!p) {
        board.append(el('span', 'sg-cell sg-empty'));
        continue;
      }
      const s = summary.get(key(p));
      const cell = el('a', `sg-cell${s ? '' : ' no-data'}`);
      cell.href = spotUrl(p.i, p.j);
      if (s) cell.style.background = sunlitColor(s.sunlit_pct);
      const d = describe(p);
      cell.setAttribute('aria-label', `${d.where}${d.nums ? `, ${d.nums}` : ''}`);
      cell.addEventListener('pointerenter', () => show(p, isHere(p)));
      cell.addEventListener('focus', () => show(p, isHere(p)));
      cell.addEventListener('pointerleave', showCurrent);
      cell.addEventListener('blur', showCurrent);
      cell.addEventListener('click', (ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return; // new tab / window
        ev.preventDefault();
        if (!isHere(p)) onPick(p);
      });
      cells.set(key(p), cell);
      board.append(cell);
    }
  }
  wrap.append(
    el('span', 'sg-compass sg-n', 'N'), el('span', 'sg-compass sg-s', 'S'),
    el('span', 'sg-compass sg-w', 'W'), el('span', 'sg-compass sg-e', 'E'),
    board,
  );

  const legend = el('div', 'sg-legend');
  if (summaries) {
    const ramp = el('div', 'sg-ramp');
    ramp.style.background = `linear-gradient(90deg, ${STOPS.map(([p, c]) => `${rgb(c)} ${p}%`).join(', ')})`;
    const ends = el('div', 'sg-ends');
    ends.append(el('span', '', '0%'), el('span', '', 'sunlit in 2027'), el('span', '', '100%'));
    legend.append(ramp, ends);
  }

  section.append(wrap, readWhere, readNums, legend);

  const setCurrent = (p: GridPoint) => {
    cells.get(key(current))?.classList.remove('current');
    cells.get(key(current))?.removeAttribute('aria-current');
    current = p;
    const cell = cells.get(key(p));
    cell?.classList.add('current');
    cell?.setAttribute('aria-current', 'location');
    // Keep the readout on the hovered / focused square, if any.
    if (!section.querySelector('.sg-cell:hover') && !section.contains(document.activeElement)) showCurrent();
    else if (document.activeElement === cell || cell?.matches(':hover')) show(p, true);
  };
  setCurrent(current);

  const refresh = () => {
    if (!opts.decorate) return;
    for (const p of points) {
      const cell = cells.get(key(p));
      if (!cell) continue;
      const mark = opts.decorate(p);
      cell.textContent = mark?.text ?? '';
      cell.className = `sg-cell${summary.get(key(p)) ? '' : ' no-data'}${isHere(p) ? ' current' : ''}${mark?.cls ? ` ${mark.cls}` : ''}`;
      const d = describe(p);
      cell.setAttribute('aria-label', `${d.where}${d.nums ? `, ${d.nums}` : ''}`);
    }
    if (!section.querySelector('.sg-cell:hover')) showCurrent();
  };
  refresh();
  return { el: section, setCurrent, refresh };
}
