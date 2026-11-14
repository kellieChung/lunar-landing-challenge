import './style.css';
import { Picker } from './screens/picker';
import { closeSite, openSite } from './screens/site';

// Hash routes:  #/ (or empty) = globe site picker,  #/site/<id> = panorama.
// Query params (e.g. ?hour=N) sit before the hash and keep working.

const pickerScreen = document.getElementById('picker-screen')!;
const panoScreen = document.getElementById('pano-screen')!;
const errorBox = document.getElementById('error')!;

let picker: Promise<Picker> | null = null;

function showError(err: unknown): void {
  console.error(err);
  errorBox.textContent = String(err);
  errorBox.hidden = false;
}

async function route(): Promise<void> {
  errorBox.hidden = true;
  const m = window.location.hash.match(/^#\/site\/([a-z0-9-]+)$/);
  if (m) {
    (await picker)?.stop();
    pickerScreen.hidden = true;
    panoScreen.hidden = false;
    await openSite(m[1]);
  } else {
    closeSite();
    panoScreen.hidden = true;
    pickerScreen.hidden = false;
    picker ??= Picker.create();
    (await picker).start();
  }
}

window.addEventListener('hashchange', () => route().catch(showError));
route().catch(showError);
