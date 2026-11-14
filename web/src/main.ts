import './style.css';
import { Picker, type PickerFocus } from './screens/picker';
import { openSite } from './screens/site';

// Routes (full page loads, so the globe and the panorama never share a page):
//   ./                          globe site picker + plain list of sites
//   ./?focus=<id>&pt=i,j        picker zoomed onto a site's grid, spot (i, j) picked
//   ./?site=<id>&pt=i,j         panorama at grid point (i, j) of a site (default 0,0 = center;
//                               also ?hour=N, ?view=2d|3d)
// Old links (#/site/<id>, artemis-candidate) are rewritten to the new form.

const ALIASES: Record<string, string> = { 'artemis-candidate': 'nobile-rim-2' };
const LEGACY_HASH = /^#\/site\/([a-z0-9-]+)$/;

const pickerScreen = document.getElementById('picker-screen')!;
const panoScreen = document.getElementById('pano-screen')!;
const errorBox = document.getElementById('error')!;

function showError(err: unknown): void {
  console.error(err);
  errorBox.textContent = String(err);
  errorBox.hidden = false;
}

/** Site id from the URL, rewriting legacy forms in place. null = picker. */
function siteFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const legacy = window.location.hash.match(LEGACY_HASH)?.[1];
  let id = params.get('site') ?? legacy ?? null;
  if (id && ALIASES[id]) id = ALIASES[id];
  if (id && (id !== params.get('site') || legacy)) {
    params.set('site', id);
    history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }
  return id && /^[a-z0-9-]+$/.test(id) ? id : null;
}

/** ?focus=<id>&pt=i,j on the picker. */
function focusFromUrl(): PickerFocus | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('focus');
  if (!id || !/^[a-z0-9-]+$/.test(id)) return null;
  const m = (params.get('pt') ?? '').match(/^(-?\d+),(-?\d+)$/);
  return { id, pt: m ? [Number(m[1]), Number(m[2])] : [0, 0] };
}

async function showPicker(): Promise<void> {
  panoScreen.hidden = true;
  pickerScreen.hidden = false;
  (await Picker.create(focusFromUrl())).start();
}

async function route(): Promise<void> {
  const id = siteFromUrl();
  if (!id) return showPicker();
  pickerScreen.hidden = true;
  panoScreen.hidden = false;
  try {
    await openSite(id);
  } catch (err) {
    showError(`Could not open site "${id}". Pick one from the list below.\n${String(err)}`);
    await showPicker();
  }
}

// An old-style link clicked on this page: reload in the new form.
window.addEventListener('hashchange', () => {
  const legacy = window.location.hash.match(LEGACY_HASH)?.[1];
  if (legacy) window.location.replace(`${window.location.pathname}?site=${ALIASES[legacy] ?? legacy}`);
});

route().catch(showError);
