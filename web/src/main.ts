import './style.css';
import { loadSite } from './data/load';
import { Panorama } from './panorama/Panorama';
import { maskAt } from './panorama/geometry';

async function main(): Promise<void> {
  const data = await loadSite('fake');
  if (data.fake) document.getElementById('badge')!.hidden = false;

  const canvas = document.getElementById('panorama') as HTMLCanvasElement;
  const readout = document.getElementById('readout')!;
  const pano = new Panorama(canvas);

  const center = data.grid.points.find((p) => p.dx_km === 0 && p.dy_km === 0) ?? data.grid.points[0];
  pano.setMask(center.mask_deg);

  // Milestone 1: show the first time sample only. The slider arrives in milestone 4.
  const k = 0;
  const sun = Panorama.bodyFromVector(data.sun.e[k], data.sun.n[k], data.sun.u[k]);
  const earth = Panorama.bodyFromVector(data.earth.e[k], data.earth.n[k], data.earth.u[k]);
  pano.setBodies(sun, earth);

  const fmt = (v: number) => v.toFixed(2).padStart(6);
  const update = () => {
    readout.textContent =
      `view ${fmt(pano.yaw)}°   ` +
      `sun az ${fmt(sun.az)}° el ${fmt(sun.el)}° (horizon ${fmt(maskAt(center.mask_deg, sun.az))}°)   ` +
      `earth az ${fmt(earth.az)}° el ${fmt(earth.el)}° (horizon ${fmt(maskAt(center.mask_deg, earth.az))}°)   ` +
      `vertical ×${pano.exaggeration}`;
  };
  pano.onChange = update;
  update();
}

main().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="error">${String(err)}</pre>`);
});
