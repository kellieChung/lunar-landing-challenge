// Game clock: moves the site screen's time forward at a few game-hours per
// real second by calling TimeBar.seek(), so the usual path (physics, 3D view,
// game rules through onTime) runs exactly as in Explore. The Navigator's own
// time bar stays hidden in game mode.

import type { TimeBar } from '../../ui/TimeBar';

export const SPEEDS = [
  { hoursPerSec: 2, label: 'Slow' },
  { hoursPerSec: 6, label: 'Normal' },
  { hoursPerSec: 12, label: 'Fast' },
];
export const DEFAULT_SPEED = 1;
const MAX_FRAME_S = 0.1; // no big leap after a stalled frame

export class GameClock {
  private playing = false;
  private frame = 0;
  private lastMs = 0;
  speed = SPEEDS[DEFAULT_SPEED].hoursPerSec;
  onChange: (() => void) | null = null;

  constructor(private timebar: TimeBar, private stepHours: number, private lastSample: number) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  setPlaying(on: boolean): void {
    if (on && this.timebar.time >= this.lastSample) on = false;
    if (on === this.playing) return;
    this.playing = on;
    if (on) {
      this.lastMs = performance.now();
      this.frame = requestAnimationFrame((ms) => this.tick(ms));
    } else {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.onChange?.();
  }

  setSpeed(hoursPerSec: number): void {
    this.speed = hoursPerSec;
    this.onChange?.();
  }

  private tick(ms: number): void {
    const dt = Math.min((ms - this.lastMs) / 1000, MAX_FRAME_S);
    this.lastMs = ms;
    const next = Math.min(this.timebar.time + (dt * this.speed) / this.stepHours, this.lastSample);
    this.timebar.seek(next, false);
    if (!this.playing) return; // paused by an event during seek
    if (next >= this.lastSample) {
      this.setPlaying(false);
      return;
    }
    this.frame = requestAnimationFrame((m) => this.tick(m));
  }
}
