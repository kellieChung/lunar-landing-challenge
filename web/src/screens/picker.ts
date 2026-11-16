// Main screen: 3D moon with site pins, plus an HTML list of every curated site.
// The list is the keyboard / screen-reader path and the fallback without WebGL.

import { loadSiteIndex } from '../data/load';
import type { SiteIndexEntry } from '../data/types';
import { Globe, type GlobePin } from '../globe/Globe';
import { formatLatLon } from '../globe/coords';
import { siteHasMission } from '../game/cards';
import { hash01 } from '../game/deposits';
import { hostsRuns, isUnlocked, loadProgress, rankOf, SITE_ORDER, siteDone, sitesDone, sitesToUnlock } from '../game/progress';
import { dailySeed } from '../game/seed';
import { sprite } from '../game/ui/sprites';


/** Today's Daily Mission site: the same for everyone on a date (no server). */
function dailySite(): string | null {
  if (SITE_ORDER.length === 0) return null;
  return SITE_ORDER[Math.floor(hash01(dailySeed()) * SITE_ORDER.length)];
}

const START_TIP_KEY = 'halo.startTipSeen';

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

/** List order: open ice runs, then locked ones in unlock order, then the rest. */
function sortSites(sites: SiteIndexEntry[]): SiteIndexEntry[] {
  const progress = loadProgress();
  const rank = (s: SiteIndexEntry): number => {
    const status = statusOf(s);
    const i = SITE_ORDER.indexOf(s.id);
    if (status === 'ready' && s.grid && i >= 0) return isUnlocked(progress, s.id) ? i : SITE_ORDER.length + i;
    const base = 2 * SITE_ORDER.length;
    return base + (status === 'ready' ? 0 : status === 'no-data' ? 1 : 2);
  };
  return sites
    .map((s, n) => ({ s, n, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.n - b.n)
    .map((x) => x.s);
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
    picker.sites = sortSites(await loadSiteIndex());
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
    picker.playIntro();
    return picker;
  }

  start(): void {
    this.globe?.start();
  }

  /** Fresh page open: project the T² = Ka³ logo onto the Moon. */
  private playIntro(): void {
    const globe = this.globe;
    if (!globe) return;
    // Play on every fresh open or reload; skip only when arriving here by
    // clicking back from a site panorama inside the app.
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    let internal = false;
    try { internal = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch { /* bad referrer */ }
    if (internal && nav?.type !== 'reload') return;
    const caption = document.getElementById('intro-caption');
    if (caption) caption.hidden = false;
    const skip = () => globe.dismissLogo();
    addEventListener('pointerdown', skip, { once: true });
    addEventListener('keydown', skip, { once: true });
    globe.onLogoFadeOut = () => caption?.classList.add('intro-out');
    globe
      .projectLogo(`${import.meta.env.BASE_URL}intro-t2ka3.png`)
      .catch((err) => console.error(err))
      .finally(() => {
        removeEventListener('pointerdown', skip);
        removeEventListener('keydown', skip);
        caption?.remove();
      });
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
    this.renderStartTip();
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
      const done = siteDone(loadProgress(), s.id);
      body.append(
        el('span', 'site-name', s.name),
        el('span', 'site-meta', `${iceRunLabel(s)}${done ? ' · complete' : ''}`),
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
      ...(s.blurb ? [el('p', 'card-blurb', s.blurb)] : []),
      el('div', 'card-coords', formatLatLon(s.lat!, s.lon!)),
      action,
      ...game,
    );
    card.hidden = false;
  }

  /** Moon Base on the site card: the patch if completed, or why there's no run here, or the lock. */
  private gameCard(s: SiteIndexEntry): HTMLElement[] {
    const progress = loadProgress();
    if (!s.grid || !hostsRuns(s.id)) {
      const traces = !!s.grid && siteHasMission(s.grid);
      return [
        el('p', 'card-dark', traces
          ? 'Every crater floor in reach sees some Sun, so too little ice survives to fill your tank in time. Good for power; no ice run.'
          : 'No crater floor near here stays dark enough for ice to last (our cold-trap rule, from the 2027 sunlight). Good for power; no ice run.'),
        el('span', 'go disabled card-game', 'No ice run here'),
      ];
    }
    if (!isUnlocked(progress, s.id)) {
      const need = sitesToUnlock(progress, s.id);
      const row = el('div', 'card-patch');
      row.append(sprite('i-lock', { scale: 2, label: 'Locked' }), el('span', '', `Launch from ${need} more open site${need === 1 ? '' : 's'} to fly here.`));
      return [row, el('span', 'go disabled card-game', 'Ice run locked')];
    }
    const best = progress.best[s.id];
    const done = siteDone(progress, s.id);
    const row = el('div', 'card-patch');
    if (done) row.append(sprite('patch-golden', { scale: 2, label: 'Completed' }));
    row.append(el('span', 'card-patch-text', done ? `Complete${best?.days != null ? `: launched on day ${Math.ceil(best.days)}` : ''}` : 'Not launched yet'));
    return [row, Object.assign(el('a', 'go card-game', 'Start an ice run →'), { href: `?site=${s.id}&mode=game` })];
  }

  /** "Where to start?" at the top of the panel: Explore first, then the game. Dismissible. */
  private renderStartTip(): void {
    const panel = document.querySelector('.picker-panel');
    if (!panel || panel.querySelector('.start-tip')) return;
    try { if (localStorage.getItem(START_TIP_KEY)) return; } catch { /* storage blocked: show it */ }
    const box = el('div', 'start-tip');
    box.setAttribute('role', 'note');
    const step = (n: string, title: string, body: string, btn: string) => {
      const li = el('li', 'start-step');
      const text = el('div', 'start-step-text');
      const head = el('b', 'start-step-title', title);
      const p = el('p', '');
      const [before, after] = body.split('%');
      p.append(before, el('span', 'start-btn', btn), after);
      text.append(head, p);
      li.append(el('span', 'start-num', n), text);
      return li;
    };
    const ol = el('ol', 'start-steps');
    ol.append(
      step('1', 'Explore first', 'Pick a site, then press % to look around and see when it gets sunlight and can reach Earth.', 'Stand here'),
      step('2', 'Then play the game', 'Press % to land, dig up ice and fuel your rocket home.', 'Start an ice run'),
    );
    const ok = el('button', 'go start-ok', 'Got it');
    ok.type = 'button';
    ok.onclick = () => {
      box.remove();
      try { localStorage.setItem(START_TIP_KEY, '1'); } catch { /* fine */ }
    };
    box.append(el('p', 'start-title', 'New here? Start in this order:'), ol, ok);
    panel.querySelector('h2')?.after(box);
  }

  /** The Daily Mission line at the top of the panel, and the player's rank. */
  private renderDaily(): void {
    const id = dailySite();
    const panel = document.querySelector('.picker-panel');
    if (!panel || !id) return;
    panel.querySelector('.daily')?.remove();
    const site = this.sites.find((x) => x.id === id);
    const box = el('div', 'daily');
    const done = sitesDone(loadProgress());
    box.append(
      el('span', 'daily-rank', `${rankOf(done)} · ${done} of ${SITE_ORDER.length} sites`),
      Object.assign(el('a', 'go daily-go', `Daily mission: ${site?.name ?? id} →`), { href: `?site=${id}&mode=game&daily=1` }),
    );
    panel.querySelector('h2')?.after(box);
  }
}
