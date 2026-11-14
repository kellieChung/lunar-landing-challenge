// Main screen: 3D moon with site pins, plus an HTML list of every curated site.
// The list is the keyboard / screen-reader path and the fallback without WebGL.

import { loadSiteIndex } from '../data/load';
import type { SiteIndexEntry } from '../data/types';
import { Globe, type GlobePin } from '../globe/Globe';
import { GridFocus, pointCard, type FocusSite } from '../globe/GridFocus';
import { formatLatLon } from '../globe/coords';

/** Picker URL (?focus=<id>&pt=i,j) so coming back from a panorama reopens the same spot. */
export interface PickerFocus {
  id: string;
  pt: [number, number];
}

function setPickerUrl(focus: PickerFocus | null): void {
  const q = focus ? `?focus=${focus.id}&pt=${focus.pt[0]},${focus.pt[1]}` : '';
  history.replaceState(null, '', `${window.location.pathname}${q}`);
}

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
  private focus: GridFocus | null = null;
  private sites: SiteIndexEntry[] = [];
  private items = new Map<string, HTMLElement>();

  private constructor() {}

  static async create(initial: PickerFocus | null = null): Promise<Picker> {
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
      const focus = new GridFocus(globe, canvas.parentElement ?? document.body);
      focus.onPick = (p) => {
        const site = picker.focusSite(focus.siteId ?? '');
        if (!site) return;
        picker.renderPointCard(site, p);
        setPickerUrl({ id: site.id, pt: [p.i, p.j] });
      };
      focus.onExit = () => {
        setPickerUrl(null);
        const id = picker.selectedId;
        const site = picker.sites.find((x) => x.id === id);
        if (site) picker.renderCard(site);
      };
      picker.focus = focus;
    } catch (err) {
      console.error(err);
      document.getElementById('globe-fallback')!.hidden = false;
    }

    const wanted = initial && picker.sites.find((s) => s.id === initial.id && statusOf(s) !== 'no-coords');
    const first = wanted || (picker.sites.find((s) => statusOf(s) === 'ready') ?? picker.sites.find((s) => statusOf(s) !== 'no-coords'));
    if (first) {
      picker.globe?.lookAt(first.lat!, first.lon!);
      picker.select(first.id, wanted ? initial!.pt : null); // zoom straight in only when coming back to a spot
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

  private selectedId: string | null = null;

  /**
   * Select a site. zoomTo (grid i, j) also flies down onto it to pick a spot,
   * when the site has a grid. Returns true if the camera was taken over.
   */
  select(id: string, zoomTo: [number, number] | null = [0, 0]): boolean {
    const site = this.sites.find((s) => s.id === id);
    if (!site || statusOf(site) === 'no-coords') return false;
    this.selectedId = id;
    this.globe?.setSelected(id);
    for (const [sid, item] of this.items) {
      item.classList.toggle('selected', sid === id);
      item.querySelector('button')?.setAttribute('aria-pressed', String(sid === id));
    }
    const fs = this.focusSite(id);
    if (fs && this.focus && zoomTo) {
      this.focus.enter(fs, zoomTo); // its onPick renders the point card
      return true;
    }
    if (this.focus?.active) this.focus.exit();
    this.renderCard(site);
    return false;
  }

  private focusSite(id: string): FocusSite | null {
    const s = this.sites.find((x) => x.id === id);
    if (!s || !s.grid?.length || s.lat === null || s.lon === null) return null;
    return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, grid: s.grid };
  }

  private renderPointCard(site: FocusSite, p: NonNullable<SiteIndexEntry['grid']>[number]): void {
    const card = document.getElementById('site-card')!;
    card.replaceChildren(...pointCard(site, p));
    card.hidden = false;
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
          // List picks fly down onto built sites, or swing the globe to the pin.
          if (!this.select(s.id)) this.globe?.lookAt(s.lat!, s.lon!);
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

  renderCard(s: SiteIndexEntry): void {
    const card = document.getElementById('site-card')!;
    const status = statusOf(s);
    let action: HTMLElement =
      status === 'ready'
        ? Object.assign(el('a', 'go', 'Stand here →'), { href: `?site=${s.id}` })
        : el('span', 'go disabled', STATUS_LABEL[status]);
    if (status === 'ready' && this.focus && this.focusSite(s.id)) {
      const zoom = el('button', 'go', 'Choose a spot →');
      zoom.type = 'button';
      zoom.addEventListener('click', () => this.select(s.id));
      action = zoom;
    }
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
