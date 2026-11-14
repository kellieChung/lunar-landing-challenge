import { describe, expect, it } from 'vitest';
import { batteryState, signalBars } from './status';
import { stateSince, nextChange } from './events';
import { valueAt, vectorAt } from './time';

describe('batteryState', () => {
  it('is full and charging while lit', () => {
    expect(batteryState(true, 0, false)).toMatchObject({ level: 1, charging: true, hoursLeft: 72 });
  });
  it('drains linearly over 72 h of dark, then stays empty', () => {
    expect(batteryState(false, 18, false)).toMatchObject({ level: 0.75, charging: false, hoursLeft: 54 });
    expect(batteryState(false, 100, false)).toMatchObject({ level: 0, hoursLeft: 0 });
  });
});

describe('signalBars', () => {
  const r = 0.95;
  it('maps the clearance above the horizon to 0-4 bars', () => {
    expect(signalBars(-0.1, r)).toBe(0);
    expect(signalBars(0, r)).toBe(0);
    expect(signalBars(0.5, r)).toBe(1);
    expect(signalBars(1.5, r)).toBe(2);
    expect(signalBars(3, r)).toBe(3);
    expect(signalBars(6, r)).toBe(4);
  });
});

describe('time interpolation', () => {
  const v = { e: [1, 0], n: [0, 1], u: [0, 0] };
  it('is exact on samples and normalized between them', () => {
    expect(vectorAt(v, 0)).toEqual([1, 0, 0]);
    expect(vectorAt(v, 1)).toEqual([0, 1, 0]);
    expect(Math.hypot(...vectorAt(v, 0.5))).toBeCloseTo(1, 12);
    expect(valueAt([2, 4, 8], 1.5)).toBe(6);
  });
});

describe('events on a simple on/off pattern', () => {
  // Step state: on during [3, 7), as if it were sampled hourly.
  const stateAt = (t: number) => t >= 3 && t < 7;
  const hourly = Array.from({ length: 12 }, (_, j) => (stateAt(j) ? 1 : 0));
  it('finds the next change and moves on when repeated', () => {
    expect(nextChange(stateAt, hourly, 0, true)).toBeCloseTo(3, 9);
    expect(nextChange(stateAt, hourly, 0, false)).toBeCloseTo(7, 9);
    expect(nextChange(stateAt, hourly, 3, true)).toBeNull(); // no later rise
  });
  it('knows when the current state began', () => {
    expect(stateSince(stateAt, hourly, 9.5)).toBeCloseTo(7, 9);
    expect(stateSince(stateAt, hourly, 5)).toBeCloseTo(3, 9);
    expect(stateSince(stateAt, hourly, 2)).toBe(0); // since the first sample
  });
});
