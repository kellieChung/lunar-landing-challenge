import { describe, expect, it } from 'vitest';
import { filterCollidingLabels, rectsOverlap } from './collision';

describe('collision', () => {
  it('detects overlapping rects', () => {
    const a = { left: 0, top: 0, right: 100, bottom: 20 };
    const b = { left: 50, top: 10, right: 150, bottom: 30 };
    const c = { left: 200, top: 0, right: 300, bottom: 20 };

    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(a, c)).toBe(false);
  });

  it('keeps both labels when they do not overlap', () => {
    const candidates = [
      { item: 'label1', rect: { left: 0, top: 0, right: 100, bottom: 20 }, priority: 0 },
      { item: 'label2', rect: { left: 150, top: 0, right: 250, bottom: 20 }, priority: 0 },
    ];
    const result = filterCollidingLabels(candidates);
    expect(result).toEqual(['label1', 'label2']);
  });

  it('filters out colliding lower-priority labels', () => {
    const candidates = [
      { item: 'normal', rect: { left: 10, top: 5, right: 110, bottom: 25 }, priority: 0 },
      { item: 'selected', rect: { left: 0, top: 0, right: 100, bottom: 20 }, priority: 2 },
    ];
    const result = filterCollidingLabels(candidates);
    expect(result).toEqual(['selected']);
  });

  it('always retains all high-priority items even if they overlap with each other', () => {
    const candidates = [
      { item: 'selected', rect: { left: 0, top: 0, right: 100, bottom: 20 }, priority: 2 },
      { item: 'hovered', rect: { left: 10, top: 5, right: 110, bottom: 25 }, priority: 1 },
      { item: 'normal', rect: { left: 20, top: 10, right: 120, bottom: 30 }, priority: 0 },
    ];
    const result = filterCollidingLabels(candidates);
    expect(result).toEqual(['selected', 'hovered']);
  });
});
