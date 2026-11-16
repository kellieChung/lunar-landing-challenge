// The run in progress, saved so a reload can pick it up again. One run at a
// time; finished runs are cleared (their result lives in progress.ts).

import type { Run } from './run';

const KEY = 'moonbase:v2:run';

export function loadRun(siteId: string): Run | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const r = raw ? (JSON.parse(raw) as Run) : null;
    return r && r.v === 2 && r.siteId === siteId && r.endedHour === null ? r : null;
  } catch {
    return null; // storage blocked or the save is damaged: start fresh
  }
}

export function saveRun(r: Run): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage full or blocked: the game still works, it just won't be remembered.
  }
}

export function clearRun(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
