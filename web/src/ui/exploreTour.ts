// Quick tour of the Explore view: four tooltips, shown once per browser and
// again from the "Tour" button.

import { SHORT } from '../tips';
import { Tip } from './Tip';

const SEEN_KEY = 'lsn:tour:explore:v1';

interface Step {
  target: () => Element | null;
  text: string;
  before?: () => void;
}

const STEPS: Step[] = [
  { target: () => document.querySelector('#stats .st-now'), text: SHORT.power },
  {
    // The grid lives in a collapsed "Pick a spot on the map" section: open it first.
    before: () => {
      const details = document.querySelector('#stats .spot-grid')?.closest('details');
      if (details) details.open = true;
      document.querySelector('#stats .spot-grid')?.scrollIntoView({ block: 'nearest' });
    },
    target: () => document.querySelector('#stats .spot-grid .sg-board'),
    text: SHORT.grid,
  },
  { target: () => document.querySelectorAll('#stats .st-gauge')[1] ?? null, text: SHORT.earth },
  { target: () => document.getElementById('timebar'), text: SHORT.timeline },
];

function seen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked: the tour just shows again next time
  }
}

let tip: Tip | null = null;

/** Run the tour (only the first time unless `force`). */
export function startExploreTour(force = false): void {
  if (!force && seen()) return;
  tip ??= new Tip();
  const t = tip;
  let i = 0;
  const finish = () => {
    t.hide();
    markSeen();
  };
  const show = () => {
    const s = STEPS[i];
    s.before?.();
    const target = s.target();
    if (!target) { // element missing (e.g. no WebGL, no grid): skip it
      if (++i < STEPS.length) show();
      else finish();
      return;
    }
    const last = i === STEPS.length - 1;
    t.show({
      target, text: s.text, step: `${i + 1} of ${STEPS.length}`,
      next: last ? 'Got it' : 'Next',
      onNext: () => {
        if (last) finish();
        else {
          i++;
          show();
        }
      },
      onSkip: last ? undefined : finish,
    });
  };
  show();
}
