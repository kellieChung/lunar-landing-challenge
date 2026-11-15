// Checks on the shipped site files: the site picker promises a mission exactly
// where the game can start one, and every crater follows the tier rule.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GridSummary, SiteData, SiteIndexEntry } from '../data/types';
import { dominates, landingCards, siteHasMission, spotMetrics } from './cards';
import { craterSpots } from './deposits';
import { buildWorld } from './env';
import { keyOf } from './state';

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url), 'utf8')) as T;
const index = read<{ sites: SiteIndexEntry[] }>('sites.json').sites;

describe('shipped data', () => {
  it('the site picker offers a mission exactly where the game can start one', () => {
    for (const site of index) {
      if (!site.grid) continue;
      const world = buildWorld(read<SiteData>(`${site.id}.json`), site.grid as GridSummary[]);
      const keys = new Set(craterSpots(site.grid as GridSummary[]).map(keyOf));
      for (const k of world.craters) expect(keys.has(k), `${site.id} ${k}`).toBe(true);
      expect(landingCards(world).length > 0, site.id).toBe(siteHasMission(site.grid as GridSummary[]));
    }
  });

  it('landing options are three trade-offs: none beats another on every metric', () => {
    for (const site of index) {
      if (!site.grid || !siteHasMission(site.grid as GridSummary[])) continue;
      const world = buildWorld(read<SiteData>(`${site.id}.json`), site.grid as GridSummary[]);
      for (const r of [0, 0.5, 0.99]) {
        const cards = landingCards(world, () => r);
        expect(cards.length, site.id).toBe(3);
        const m = cards.map((c) => spotMetrics(world, (c as { spot: string }).spot));
        for (const a of m) for (const b of m) if (a !== b) expect(dominates(a, b), site.id).toBe(false);
      }
    }
  });
});
