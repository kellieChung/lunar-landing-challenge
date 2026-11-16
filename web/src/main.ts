import './style.css';
import './skin';
import { Picker } from './screens/picker';
import { openSite } from './screens/site';

// Routes (full page loads, so the globe and the panorama never share a page):
//   ./                          globe site picker + plain list of sites
//   ./?focus=<id>               picker with that site selected
//   ./?site=<id>&pt=i,j         panorama at grid point (i, j) of a site (default 0,0 = center;
//                               also ?hour=N, ?view=2d|3d); the sidebar grid moves between spots

const pickerScreen = document.getElementById('picker-screen')!;
const panoScreen = document.getElementById('pano-screen')!;
const errorBox = document.getElementById('error')!;

function showError(err: unknown): void {
  console.error(err);
  errorBox.textContent = String(err);
  errorBox.hidden = false;
}

/** Site id from the URL. null = picker. */
function siteFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get('site');
  return id && /^[a-z0-9-]+$/.test(id) ? id : null;
}

/** ?focus=<id> on the picker: the site to select. */
function focusFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get('focus');
  return id && /^[a-z0-9-]+$/.test(id) ? id : null;
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

route().catch(showError);
