// "Raise the mast": a slider and presets for the height of the solar panel
// and antenna (3 to 30 m), at any spot on the 1 km grid. Each height has its
// own horizon masks (<site_id>_mast<h>.json, loaded when picked); this widget
// only shows the choices and the year numbers Python precomputed for each
// spot and height. The physics for the chosen height runs in src/physics.

import type { GridSummary, MastYear, SiteData } from '../data/types';
import './mastControl.css';

export const BASE_MAST_M = 3;

/** One-click presets (spec: small lander, power tower, VSAT-XL-class tower). */
const PRESETS: { m: number; label: string; title: string }[] = [
  { m: 3, label: 'Lander', title: 'Small lander: solar panel and antenna about 3 m up' },
  { m: 10, label: 'Tower', title: 'Power tower: about 10 m up' },
  { m: 30, label: 'VSAT-XL', title: 'VSAT-XL-class tower: arrays over 10 m up on a 30 m tower (Astrobotic)' },
];

export interface MastRow {
  m: number;
  year: MastYear;
}

type Pre = {
  points?: { i: number; j: number; year: MastYear }[];
  mast?: { height_m: number; points: { i: number; j: number; year: MastYear }[] }[];
};

/** Heights we have data for (3 m first, never lower). Empty for files without raised masts. */
export function mastHeights(data: SiteData): number[] {
  const pre = data.precomputed as Pre;
  if (!data.mast || !pre.mast) return [];
  const raised = data.mast.heights_m.filter((h) => h > BASE_MAST_M && data.mast!.files[String(h)]
    && pre.mast!.some((m) => m.height_m === h));
  return [BASE_MAST_M, ...raised.sort((a, b) => a - b)];
}

/** Full-year numbers at grid spot (i, j) for every height (3 m from the main grid). */
export function mastRows(data: SiteData, i: number, j: number): MastRow[] {
  const pre = data.precomputed as Pre;
  const at = <T extends { i: number; j: number }>(list: T[] | undefined) => list?.find((p) => p.i === i && p.j === j);
  const rows: MastRow[] = [];
  for (const m of mastHeights(data)) {
    const year = m === BASE_MAST_M ? at(pre.points)?.year : at(pre.mast!.find((x) => x.height_m === m)?.points)?.year;
    if (year) rows.push({ m, year });
  }
  return rows;
}

/** The spot map's numbers at one height: positions and ground from the 3 m summaries, year numbers from that height. */
export function mastSummaries(data: SiteData, base: GridSummary[], m: number): GridSummary[] {
  if (m === BASE_MAST_M) return base;
  const pts = (data.precomputed as Pre).mast?.find((x) => x.height_m === m)?.points ?? [];
  const byIj = new Map(pts.map((p) => [`${p.i},${p.j}`, p.year]));
  return base.map((s) => ({ ...s, ...(byIj.get(`${s.i},${s.j}`) ?? {}) }));
}

const sign = (v: number) => (v >= 0 ? '+' : '−');
const days = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${Math.round(h)} h`);

/** "Sunlit 46.4% (+19.4) · Earth 53.2% (+6.3) · longest night 28.1 d (was 117.0 d)" against 3 m. */
export function describeEffect(row: MastRow, base: MastRow): string {
  const ds = row.year.sunlit_pct - base.year.sunlit_pct;
  const de = row.year.earth_pct - base.year.earth_pct;
  const diff = (d: number) => (row.m === base.m ? '' : ` (${sign(d)}${Math.abs(d).toFixed(1)})`);
  const night = row.m === base.m || row.year.longest_dark_h === base.year.longest_dark_h
    ? days(row.year.longest_dark_h)
    : `${days(row.year.longest_dark_h)} (was ${days(base.year.longest_dark_h)})`;
  return `Sunlit ${row.year.sunlit_pct.toFixed(1)}%${diff(ds)} · Earth ${row.year.earth_pct.toFixed(1)}%${diff(de)} · longest night ${night}`;
}

/** Height from ?mast=N, if it is one we have data for (else 3 m). */
export function mastFromUrl(heights: number[]): number {
  const raw = Number(new URLSearchParams(window.location.search).get('mast'));
  return heights.includes(raw) ? raw : BASE_MAST_M;
}

export interface MastControl {
  el: HTMLElement;
  /** Show a height and that spot's year numbers per height, without firing onPick. */
  set(m: number, rows: MastRow[]): void;
  /** While a height's horizons download: show it and say so. */
  setLoading(m: number | null): void;
}

/** The control. onPick(m) fires on every slider step or preset click. */
export function mastControl(heights: number[], current: number, rows: MastRow[],
  onPick: (m: number) => void): MastControl {
  const el = document.createElement('section');
  el.className = 'mast';
  el.setAttribute('aria-label', 'Mast height');
  const idOf = (m: number) => Math.max(0, heights.indexOf(m));
  el.innerHTML = `
    <div class="mast-head">
      <label class="st-label" for="mast-range">Mast height</label>
      <output class="mast-value" for="mast-range"></output>
    </div>
    <input id="mast-range" class="mast-range" type="range" min="0" max="${heights.length - 1}" step="1"
      aria-describedby="mast-effect">
    <div class="mast-ticks" aria-hidden="true">${heights.map((m) => `<span>${m}</span>`).join('')}</div>
    <div class="mast-presets" role="group" aria-label="Mast presets">
      ${PRESETS.filter((p) => heights.includes(p.m))
        .map((p) => `<button type="button" data-m="${p.m}" title="${p.title}">${p.label} · ${p.m} m</button>`).join('')}
    </div>
    <div id="mast-effect" class="st-sub mast-effect" aria-live="polite"></div>
    <div class="st-sub mast-note">Solar panel and antenna at this height, at every spot. The view rises with
      them, and the spot map's colors show the year at this height.</div>`;
  const range = el.querySelector('.mast-range') as HTMLInputElement;
  const value = el.querySelector('.mast-value') as HTMLOutputElement;
  const effect = el.querySelector('.mast-effect') as HTMLElement;
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('.mast-presets button')];

  const show = (m: number) => {
    range.value = String(idOf(m));
    range.setAttribute('aria-valuetext', `${m} metres`);
    value.textContent = `${m} m`;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.m) === m)));
  };
  const set = (m: number, spotRows: MastRow[]) => {
    show(m);
    el.classList.remove('loading');
    const row = spotRows.find((r) => r.m === m);
    const base = spotRows.find((r) => r.m === BASE_MAST_M);
    effect.textContent = row && base ? `Year at this spot: ${describeEffect(row, base)}` : '';
  };
  const setLoading = (m: number | null) => {
    el.classList.toggle('loading', m !== null);
    if (m !== null) {
      show(m);
      effect.textContent = `Loading the ${m} m horizons…`;
    }
  };

  range.addEventListener('input', () => onPick(heights[Number(range.value)]));
  for (const b of buttons) b.addEventListener('click', () => onPick(Number(b.dataset.m)));
  set(current, rows);
  return { el, set, setLoading };
}
