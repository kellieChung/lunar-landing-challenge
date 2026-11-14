// Stats panel beside the panorama: battery, signal bars, countdowns, the
// 30-day and full-year numbers, and the panel comparison. Shows numbers it is
// given; all of them come from src/physics.

import type { Flux, WindowMetrics } from '../physics/metrics';
import { BATTERY_HOURS, type Battery } from '../physics/status';

export interface NowStatus {
  sunFraction: number; // 0..1
  sunLit: boolean;
  earthVisible: boolean;
  earthMarginDeg: number;
  bars: number; // 0..4
  battery: Battery;
  sunEventH: number | null; // hours until the next sunset (if lit) or sunrise (if dark)
  earthEventH: number | null; // hours until the next Earthset (if visible) or Earthrise
  fluxNow: Flux;
}

export interface Windows {
  month: WindowMetrics;
  monthLabel: string; // e.g. "Jan 1 – Jan 30"
  year: WindowMetrics;
  yearLabel: string;
}

/** "2 d 04 h 13 m", "5 h 07 m", "12 m". */
export function formatDuration(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const p = (v: number) => String(v).padStart(2, '0');
  if (d > 0) return `${d} d ${p(h)} h ${p(m)} m`;
  if (h > 0) return `${h} h ${p(m)} m`;
  return `${m} m`;
}

/** Long stretches in days, short ones in hours: "10.7 d", "31 h". */
function formatStretch(hours: number): string {
  return hours >= 48 ? `${(hours / 24).toFixed(1)} d` : `${hours} h`;
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const watts = (v: number) => `${Math.round(v)}`;

const TEMPLATE = `
  <section class="st-now" aria-label="Right now">
    <div class="st-gauge">
      <svg class="st-battery" viewBox="0 0 44 22" aria-hidden="true">
        <rect x="1" y="1" width="38" height="20" rx="3" class="st-outline" />
        <rect x="40" y="7" width="3" height="8" rx="1" class="st-nub" />
        <rect x="4" y="4" width="32" height="14" rx="1" class="st-fill" />
        <path d="M22 4 L16 12 H21 L18 18 L26 9 H21 Z" class="st-bolt" />
      </svg>
      <div><div class="st-label">Power</div><div class="st-value st-battery-text"></div><div class="st-sub st-battery-sub"></div></div>
    </div>
    <div class="st-gauge">
      <svg class="st-signal" viewBox="0 0 44 22" aria-hidden="true">
        <rect x="4" y="16" width="6" height="5" /><rect x="14" y="12" width="6" height="9" />
        <rect x="24" y="7" width="6" height="14" /><rect x="34" y="2" width="6" height="19" />
      </svg>
      <div><div class="st-label">Earth contact</div><div class="st-value st-signal-text"></div><div class="st-sub st-signal-sub"></div></div>
    </div>
    <dl class="st-countdowns">
      <div><dt class="st-sun-event"></dt><dd class="st-sun-in"></dd></div>
      <div><dt class="st-earth-event"></dt><dd class="st-earth-in"></dd></div>
    </dl>
  </section>
  <section aria-label="Statistics">
    <table class="st-table">
      <thead><tr><th></th><th class="st-month-label"></th><th class="st-year-label"></th></tr></thead>
      <tbody>
        <tr><th>Sunlit</th><td data-k="sunlit_pct"></td><td data-k="sunlit_pct"></td></tr>
        <tr><th>Mean disk lit</th><td data-k="mean_sunlit_fraction"></td><td data-k="mean_sunlit_fraction"></td></tr>
        <tr><th>Earth in view</th><td data-k="earth_pct"></td><td data-k="earth_pct"></td></tr>
        <tr><th>Both</th><td data-k="both_pct"></td><td data-k="both_pct"></td></tr>
        <tr><th>Longest night</th><td data-k="longest_dark_h"></td><td data-k="longest_dark_h"></td></tr>
        <tr><th>Longest blackout</th><td data-k="longest_blackout_h"></td><td data-k="longest_blackout_h"></td></tr>
      </tbody>
    </table>
  </section>
  <section aria-label="Solar panel comparison">
    <h3 class="st-h">Solar panel power <span>W/m²</span></h3>
    <table class="st-table st-flux">
      <thead><tr><th></th><th>Now</th><th>30 d avg</th><th>Year avg</th></tr></thead>
      <tbody>
        <tr data-p="tracking"><th>Sun-tracking</th><td></td><td></td><td></td></tr>
        <tr data-p="vertical"><th>Vertical</th><td></td><td></td><td></td></tr>
        <tr data-p="horizontal"><th>Flat on the ground</th><td></td><td></td><td></td></tr>
      </tbody>
    </table>
  </section>`;

function metricText(m: WindowMetrics, key: string): string {
  switch (key) {
    case 'mean_sunlit_fraction': return m.mean_sunlit_fraction.toFixed(2);
    case 'longest_dark_h': return formatStretch(m.longest_dark_h);
    case 'longest_blackout_h': return formatStretch(m.longest_blackout_h);
    default: return pct(m[key as 'sunlit_pct' | 'earth_pct' | 'both_pct']);
  }
}

export class StatsPanel {
  private windowsShown: Windows | null = null;

  constructor(private root: HTMLElement) {
    root.innerHTML = TEMPLATE;
  }

  private q(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  setWindows(w: Windows): void {
    if (this.windowsShown?.month === w.month && this.windowsShown?.year === w.year) return;
    this.windowsShown = w;
    this.q('.st-month-label').textContent = w.monthLabel;
    this.q('.st-year-label').textContent = w.yearLabel;
    for (const row of this.root.querySelectorAll('.st-table:not(.st-flux) tbody tr')) {
      const [monthCell, yearCell] = row.querySelectorAll<HTMLElement>('td');
      for (const [cell, m] of [[monthCell, w.month], [yearCell, w.year]] as const) {
        const k = cell.dataset.k!;
        cell.textContent = metricText(m, k);
        cell.title = k.endsWith('_h') ? `${m[k as 'longest_dark_h']} h` : '';
      }
    }
    for (const row of this.root.querySelectorAll<HTMLElement>('.st-flux tbody tr')) {
      const p = row.dataset.p as keyof Flux;
      const cells = row.querySelectorAll('td');
      cells[1].textContent = watts(w.month.mean_flux_w_m2[p]);
      cells[2].textContent = watts(w.year.mean_flux_w_m2[p]);
    }
  }

  setNow(s: NowStatus): void {
    // Battery
    const b = s.battery;
    const fill = this.q('.st-fill');
    fill.setAttribute('width', String(Math.max(0, 32 * b.level)));
    this.root.classList.toggle('charging', b.charging);
    this.root.classList.toggle('low', !b.charging && b.level < 0.2);
    this.q('.st-battery-text').textContent = b.charging
      ? 'Charging'
      : b.level > 0 ? `On battery · ${formatDuration(b.hoursLeft)} left` : 'Battery empty';
    this.q('.st-battery-sub').textContent = b.charging
      ? `Sun ${Math.round(s.sunFraction * 100)}% visible`
      : `Dark for ${formatDuration(b.darkHours)}${b.sinceStart ? ' (assumed full on Jan 1)' : ''} · ${BATTERY_HOURS} h battery`;

    // Signal
    const bars = this.root.querySelectorAll('.st-signal rect');
    bars.forEach((r, i) => r.classList.toggle('on', i < s.bars));
    this.q('.st-signal-text').textContent = s.bars === 0 ? 'No service' : `${s.bars} of 4 bars`;
    const m = s.earthMarginDeg;
    this.q('.st-signal-sub').textContent = m > 0
      ? `Earth ${m.toFixed(2)}° above the horizon`
      : `Earth ${(-m).toFixed(2)}° behind terrain`;

    // Countdowns
    const never = `not in ${this.windowsShown?.yearLabel ?? 'the data'}`;
    this.q('.st-sun-event').textContent = s.sunLit ? 'Sunset in' : 'Sunrise in';
    this.q('.st-sun-in').textContent = s.sunEventH === null ? never : formatDuration(s.sunEventH);
    this.q('.st-earth-event').textContent = s.earthVisible ? 'Earthset in' : 'Earthrise in';
    this.q('.st-earth-in').textContent = s.earthEventH === null ? never : formatDuration(s.earthEventH);

    for (const row of this.root.querySelectorAll<HTMLElement>('.st-flux tbody tr')) {
      row.querySelectorAll('td')[0].textContent = watts(s.fluxNow[row.dataset.p as keyof Flux]);
    }
  }
}
