// Main screen: 3D moon with site pins, plus an HTML list of every curated site.
// The list is the keyboard / screen-reader path and the fallback without WebGL.

import { loadSiteIndex } from '../data/load';
import type { SiteIndexEntry } from '../data/types';
import { Globe, type GlobePin } from '../globe/Globe';
import { formatLatLon } from '../globe/coords';
import { siteHasMission } from '../game/cards';
import { hash01 } from '../game/deposits';
import { hostsRuns, isUnlocked, loadProgress, rankOf, SITE_ORDER, starsToUnlock, totalStars } from '../game/progress';
import { dailySeed } from '../game/seed';
import { sprite } from '../game/ui/sprites';

const PATCH = ['patch-pine', 'patch-pine', 'patch-silver', 'patch-golden'];

/** Today's Daily Mission site: the same for everyone on a date (no server). */
function dailySite(): string | null {
  if (SITE_ORDER.length === 0) return null;
  return SITE_ORDER[Math.floor(hash01(dailySeed()) * SITE_ORDER.length)];
}

type Status = 'ready' | 'no-data' | 'no-coords';

function statusOf(s: SiteIndexEntry): Status {
  if (s.lat === null || s.lon === null) return 'no-coords';
  return s.has_data ? 'ready' : 'no-data';
}

const STATUS_LABEL: Record<Exclude<Status, 'ready'>, string> = {
  'no-data': 'Data not built yet',
  'no-coords': 'Coordinates pending',
};

/** Can the player start an Ice Run here? The line under each site's name. */
function iceRunLabel(s: SiteIndexEntry): string {
  if (statusOf(s) !== 'ready' || !s.grid || !hostsRuns(s.id)) return 'No ice run';
  return isUnlocked(loadProgress(), s.id) ? 'Ice run open' : 'Ice run locked';
}

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

  static async create(initial: string | null = null): Promise<Picker> {
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

    const wanted = initial && picker.sites.find((s) => s.id === initial && statusOf(s) !== 'no-coords');
    const first = wanted || (picker.sites.find((s) => statusOf(s) === 'ready') ?? picker.sites.find((s) => statusOf(s) !== 'no-coords'));
    if (first) {
      picker.globe?.lookAt(first.lat!, first.lon!);
      picker.select(first.id);
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

  /** Select a site: highlight its pin and list item and show its card. */
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
    this.renderDaily();
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
          this.globe?.lookAt(s.lat!, s.lon!);
        });
      }
      const best = loadProgress().best[s.id]?.stars ?? 0;
      body.append(
        el('span', 'site-name', s.name),
        el('span', 'site-meta', `${iceRunLabel(s)}${best ? ` · ${best} of 3 stars` : ''}`),
      );
      li.append(body);
      list.append(li);
      this.items.set(s.id, li);
    }
  }

  private renderCard(s: SiteIndexEntry): void {
    const card = document.getElementById('site-card')!;
    const status = statusOf(s);
    const action: HTMLElement =
      status === 'ready'
        ? Object.assign(el('a', 'go', 'Stand here →'), { href: `?site=${s.id}` })
        : el('span', 'go disabled', STATUS_LABEL[status]);
    const game: HTMLElement[] = status !== 'ready' || !s.grid ? [] : this.gameCard(s);
    card.replaceChildren(
      el('h3', 'card-name', s.name),
      ...(s.blurb.startsWith('TODO(') ? [] : [el('p', 'card-blurb', s.blurb)]), // never show placeholders
      el('div', 'card-coords', formatLatLon(s.lat!, s.lon!)),
      action,
      ...game,
    );
    card.hidden = false;
  }

  /** Moon Base on the site card: the patch and stars, or why there's no run here, or the lock. */
  private gameCard(s: SiteIndexEntry): HTMLElement[] {
    const progress = loadProgress();
    if (!s.grid || !hostsRuns(s.id)) {
      const traces = !!s.grid && siteHasMission(s.grid);
      return [
        el('p', 'card-dark', traces
          ? 'Every crater floor in reach sees some Sun, so there is too little ice, and too few dark hours to dig it, to fill your tank in time. Good for power; no ice run.'
          : 'No crater floor near here stays dark enough for ice to last (our cold-trap rule, from the 2027 sunlight). Good for power; no ice run.'),
        el('span', 'go disabled card-game', 'No ice run here'),
      ];
    }
    if (!isUnlocked(progress, s.id)) {
      const need = starsToUnlock(progress, s.id);
      const row = el('div', 'card-patch');
      row.append(sprite('i-lock', { scale: 2, label: 'Locked' }), el('span', '', `Earn ${need} more star${need === 1 ? '' : 's'} to fly here.`));
      return [row, el('span', 'go disabled card-game', 'Ice run locked')];
    }
    const best = progress.best[s.id]?.stars ?? 0;
    const row = el('div', 'card-patch');
    row.append(sprite(PATCH[best], { scale: 2, label: `${best} of 3 stars` }));
    for (let i = 0; i < 3; i++) row.append(sprite(i < best ? 'star-on' : 'star-off', { scale: 2, label: i < best ? 'star' : 'no star' }));
    row.append(el('span', 'card-patch-text', best ? `Best: ${best} of 3 stars` : 'No patch yet'));
    return [row, Object.assign(el('a', 'go card-game', 'Start an ice run →'), { href: `?site=${s.id}&mode=game` })];
  }

  /** The Daily Mission line at the top of the panel, and the player's rank. */
  private renderDaily(): void {
    const id = dailySite();
    const panel = document.querySelector('.picker-panel');
    if (!panel || !id) return;
    panel.querySelector('.daily')?.remove();
    const site = this.sites.find((x) => x.id === id);
    const box = el('div', 'daily');
    const stars = totalStars(loadProgress());
    box.append(
      el('span', 'daily-rank', `${rankOf(stars)} · ${stars} stars`),
      Object.assign(el('a', 'go daily-go', `Daily mission: ${site?.name ?? id} →`), { href: `?site=${id}&mode=game&daily=1` }),
    );
    panel.querySelector('h2')?.after(box);
  }
}
