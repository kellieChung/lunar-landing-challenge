// Main screen: 3D moon with site pins, plus an HTML list of every curated site.
// The list is the keyboard / screen-reader path and the fallback without WebGL.

import { loadSiteIndex } from '../data/load';
import type { SiteIndexEntry } from '../data/types';
import { Globe, type GlobePin } from '../globe/Globe';
import { formatLatLon } from '../globe/coords';

const KIND_LABEL: Record<SiteIndexEntry['kind'], string> = {
  'south-pole': 'South pole',
  reference: 'Reference',
};

type Status = 'ready' | 'no-data' | 'no-coords';

function statusOf(s: SiteIndexEntry): Status {
  if (s.lat === null || s.lon === null) return 'no-coords';
  return s.has_data ? 'ready' : 'no-data';
}

const STATUS_LABEL: Record<Status, string> = {
  ready: 'Ready',
  'no-data': 'Data not built yet',
  'no-coords': 'Coordinates pending',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Picker {
  private globe: Globe | null = null;
  private sites: SiteIndexEntry[] = [];
  private items = new Map<string, HTMLElement>();

  private constructor() {}

  static async create(): Promise<Picker> {
    const picker = new Picker();
    picker.sites = await loadSiteIndex();
    picker.renderList();

    const pins: GlobePin[] = picker.sites
      .filter((s) => statusOf(s) !== 'no-coords')
      .map((s) => ({ id: s.id, name: s.name, lat: s.lat!, lon: s.lon! }));

    const canvas = document.getElementById('globe') as HTMLCanvasElement;
    const labels = document.getElementById('globe-labels')!;
    try {
      const globe = new Globe(canvas, labels);
      globe.onSelect = (id) => picker.select(id);
      globe.setPins(pins);
      await globe.load(`${import.meta.env.BASE_URL}models/moon.glb`);
      picker.globe = globe;
    } catch (err) {
      console.error(err);
      document.getElementById('globe-fallback')!.hidden = false;
    }

    const first = picker.sites.find((s) => statusOf(s) === 'ready') ?? picker.sites.find((s) => statusOf(s) !== 'no-coords');
    if (first) {
      picker.select(first.id);
      picker.globe?.lookAt(first.lat!, first.lon!);
    } else {
      picker.globe?.lookAt(-90, 0);
    }
    return picker;
  }

  start(): void {
    this.globe?.start();
  }

  stop(): void {
    this.globe?.stop();
  }

  select(id: string): void {
    const site = this.sites.find((s) => s.id === id);
    if (!site || statusOf(site) === 'no-coords') return;
    this.globe?.setSelected(id);
    for (const [sid, item] of this.items) {
      item.classList.toggle('selected', sid === id);
      item.querySelector('button')?.setAttribute('aria-pressed', String(sid === id));
    }
    this.renderCard(site);
  }

  private renderList(): void {
    const list = document.getElementById('site-list')!;
    list.replaceChildren();
    this.items.clear();
    for (const s of this.sites) {
      const status = statusOf(s);
      const li = el('li', `site-item status-${status}`);
      const body =
        status === 'no-coords' ? el('div', 'site-item-body') : el('button', 'site-item-body');
      if (body instanceof HTMLButtonElement) {
        body.type = 'button';
        body.setAttribute('aria-pressed', 'false');
        body.addEventListener('click', () => {
          this.select(s.id);
          this.globe?.lookAt(s.lat!, s.lon!); // list picks swing the globe to the pin
        });
      }
      body.append(
        el('span', 'site-name', s.name),
        el('span', 'site-meta', `${KIND_LABEL[s.kind]} · ${STATUS_LABEL[status]}`),
      );
      li.append(body);
      list.append(li);
      this.items.set(s.id, li);
    }
  }

  private renderCard(s: SiteIndexEntry): void {
    const card = document.getElementById('site-card')!;
    const status = statusOf(s);
    const action =
      status === 'ready'
        ? Object.assign(el('a', 'go', 'Stand here →'), { href: `?site=${s.id}` })
        : el('span', 'go disabled', STATUS_LABEL[status]);
    card.replaceChildren(
      el('div', 'card-kind', KIND_LABEL[s.kind]),
      el('h3', 'card-name', s.name),
      ...(s.blurb.startsWith('TODO(') ? [] : [el('p', 'card-blurb', s.blurb)]), // never show placeholders
      el('div', 'card-coords', formatLatLon(s.lat!, s.lon!)),
      action,
    );
    card.hidden = false;
  }
}
