import './style.css';
import { loadSite } from './data/load';
import { Panorama } from './panorama/Panorama';
import { maskAt } from './panorama/geometry';

const SITE_ID = 'artemis-candidate';

/** Dev-only: ?hour=N picks a time sample until the time slider arrives (milestone 4). */
function hourFromUrl(count: number): number {
  const raw = new URLSearchParams(window.location.search).get('hour');
  const n = raw === null ? 0 : Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), count - 1) : 0;
}

async function main(): Promise<void> {
  const data = await loadSite(SITE_ID);
  const badge = document.getElementById('badge')!;
  if (data.fake) {
    badge.textContent = 'FAKE DATA';
    badge.hidden = false;
  } else if (data.mask_fake) {
    badge.textContent = 'TERRAIN NOT REAL YET';
    badge.hidden = false;
  }

  const canvas = document.getElementById('panorama') as HTMLCanvasElement;
  const readout = document.getElementById('readout')!;
  const pano = new Panorama(canvas);

  const center = data.grid.points.find((p) => p.dx_km === 0 && p.dy_km === 0) ?? data.grid.points[0];
  pano.setMask(center.mask_deg);

  const k = hourFromUrl(data.time.count);
  const sun = Panorama.bodyFromVector(data.sun.e[k], data.sun.n[k], data.sun.u[k]);
  const earth = Panorama.bodyFromVector(data.earth.e[k], data.earth.n[k], data.earth.u[k]);
  pano.setBodies(sun, earth);

  const t = new Date(Date.parse(data.time.start) + k * data.time.step_hours * 3600_000);
  const when = t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  const fmt = (v: number) => v.toFixed(2).padStart(6);
  const update = () => {
    readout.textContent =
      `${data.site.name}   ${when} (hour ${k})   view ${fmt(pano.yaw)}°\n` +
      `sun   az ${fmt(sun.az)}° el ${fmt(sun.el)}°  (horizon there ${fmt(maskAt(center.mask_deg, sun.az))}°)\n` +
      `earth az ${fmt(earth.az)}° el ${fmt(earth.el)}°  (horizon there ${fmt(maskAt(center.mask_deg, earth.az))}°)   vertical ×${pano.exaggeration}`;
  };
  pano.onChange = update;
  update();
}

main().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="error">${String(err)}</pre>`);
});
