import { describe, expect, it } from 'vitest';
import type { GridSummary } from '../data/types';
import { H2_PER_KG_WATER, O2_PER_KG_WATER, fuelTarget, propellantKg } from './chemistry';
import {
  BATTERY_KWH, BATTERY_PACK_KWH, KEEPALIVE_KW, MAX_SLOPE_DEG, PROSPECT_HOURS, ROVER_BATTERY_KWH, ROVER_KW, ROVER_PAYLOAD_KG, ROVER_SPEED_KMH, SOLAR_TOWER_KW, SHELTER_KEEPALIVE_FACTOR, TRACE_MAX_SUNLIT,
} from './constants';
import { darkSpots, hash01, iceFraction, iceTier, tieredIce } from './deposits';
import { buildTerrain, slopeDeg } from './paths';
import {
  TARGET, buildCost, buy, chooseCrater, deliver, land, launch, orderRover, reachableDark, step, tripEnergyKWh, type Env,
} from './sim';
import { keyOf, newGame, type Key } from './state';

/** A flat 5 x 1 strip of spots, 1 km apart: x = 0..4. Spot 4 is dark. */
function strip(heights = [0, 0, 0, 0, 0]): GridSummary[] {
  return heights.map((ground_m, i) => ({
    i, j: 0, dx_km: i, dy_km: 0, lat: -85, lon: 0, ground_m, sunlit_pct: i === 4 ? 0 : 50, earth_pct: 50,
    both_pct: 25, longest_dark_h: 0, longest_blackout_h: 0,
  }));
}

function env(summaries: GridSummary[], opts: { sun?: (h: number) => number; earth?: (h: number) => boolean; ice?: number } = {}): Env {
  const terrain = buildTerrain(summaries);
  const dark = new Set(darkSpots(summaries).map(keyOf));
  return {
    solarKw: (_spot, h) => SOLAR_TOWER_KW * (opts.sun ? opts.sun(h) : 1),
    earthVisible: (_spot, h) => (opts.earth ? opts.earth(h) : true),
    route: terrain.route,
    legKm: terrain.legKm,
    distanceKm: terrain.distanceKm,
    iceFraction: (k: Key) => (dark.has(k) ? opts.ice ?? 0.056 : null),
    isDark: (k: Key) => dark.has(k),
    isCrater: (k: Key) => dark.has(k),
    earthHoursLeft: (_spot, h) => {
      let n = 0;
      while (n < 10000 && (opts.earth ? opts.earth(h + n) : true)) n++;
      return n;
    },
  };
}

describe('chemistry', () => {
  it('splits water into hydrogen and oxygen without losing mass', () => {
    expect(H2_PER_KG_WATER + O2_PER_KG_WATER).toBeCloseTo(1, 12);
    expect(H2_PER_KG_WATER).toBeCloseTo(0.1119, 4);
  });

  it('rocket equation matches a hand calculation', () => {
    // 500 kg, 2800 m/s, Isp 450 s: 500 * (e^(2800 / 4412.99) - 1) = 443.0 kg
    expect(propellantKg(500, 2800, 450)).toBeCloseTo(443.0, 0);
    expect(propellantKg(500, 0, 450)).toBe(0);
  });

  it('fuel target adds up, with oxygen to spare', () => {
    const t = fuelTarget(500, 2800, 450, 6);
    expect(t.h2Kg + t.o2Kg).toBeCloseTo(t.propellantKg, 9);
    expect(t.o2Kg / t.h2Kg).toBeCloseTo(6, 9);
    expect(t.waterKg * H2_PER_KG_WATER).toBeCloseTo(t.h2Kg, 9);
    expect(t.spareO2Kg).toBeGreaterThan(0); // water gives 7.94 : 1, the engine burns 6 : 1
  });
});

describe('deposits', () => {
  it('is the same every time and stays inside the LCROSS range', () => {
    expect(iceFraction('nobile-rim-2', 1, -2)).toBe(iceFraction('nobile-rim-2', 1, -2));
    for (let i = -5; i <= 5; i++) {
      for (let j = -5; j <= 5; j++) {
        const f = iceFraction('haworth', i, j);
        expect(f).toBeGreaterThanOrEqual(0.027 - 1e-12);
        expect(f).toBeLessThanOrEqual(0.085 + 1e-12);
      }
    }
    expect(hash01('a')).not.toBe(hash01('b'));
  });

  it('only fully dark spots count as dark', () => {
    expect(darkSpots(strip()).map(keyOf)).toEqual(['4,0']);
  });

  it('cold-trap tiers: rich in full dark, a shrinking trace up to the cut-off, none above', () => {
    expect(iceTier(0)).toBe('rich');
    expect(iceTier(TRACE_MAX_SUNLIT / 2)).toBe('trace');
    expect(iceTier(TRACE_MAX_SUNLIT)).toBe('trace');
    expect(iceTier(TRACE_MAX_SUNLIT + 0.001)).toBe('none');
    const rich = tieredIce('haworth', 1, 1, 0);
    expect(rich).toBe(iceFraction('haworth', 1, 1));
    const nearDark = tieredIce('haworth', 1, 1, 1e-6);
    expect(tieredIce('haworth', 1, 1, TRACE_MAX_SUNLIT / 2)).toBeCloseTo(nearDark / 2, 6);
    expect(tieredIce('haworth', 1, 1, TRACE_MAX_SUNLIT)).toBe(0);
    // A trace floor never holds more ice than any rich floor.
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) expect(tieredIce('haworth', i, j, 1e-6)).toBeLessThanOrEqual(0.027 + 1e-12);
    expect(tieredIce('haworth', 1, 1, 0.5)).toBe(0);
  });
});

describe('paths', () => {
  it('finds the straight route on flat ground', () => {
    const r = buildTerrain(strip()).route('0,0', '4,0');
    expect(r?.km).toBeCloseTo(4, 9);
    expect(r?.keys).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
  });

  it('refuses a step steeper than the limit', () => {
    const rise = Math.tan(((MAX_SLOPE_DEG + 1) * Math.PI) / 180) * 1000;
    expect(slopeDeg(rise, 1)).toBeCloseTo(MAX_SLOPE_DEG + 1, 6);
    expect(buildTerrain(strip([0, 0, rise, rise, rise])).route('0,0', '4,0')).toBeNull();
    const gentle = Math.tan(((MAX_SLOPE_DEG - 1) * Math.PI) / 180) * 1000;
    expect(buildTerrain(strip([0, 0, gentle, gentle, gentle])).route('0,0', '4,0')).not.toBeNull();
  });
});

describe('sim', () => {
  it('will not land in the dark or where no dark spot can be reached', () => {
    const s = newGame('test');
    expect(land(s, env(strip()), '4,0', ['4,0']).ok).toBe(false);
    const cliff = env(strip([0, 0, 5000, 5000, 5000]));
    expect(land(s, cliff, '0,0', ['4,0']).ok).toBe(false);
    expect(land(s, env(strip()), '0,0', ['4,0']).ok).toBe(true);
    expect(s.rovers).toHaveLength(1);
  });

  it('drains the battery in the dark, sleeps, then wakes when the Sun returns', () => {
    const dark = Math.ceil(BATTERY_KWH / KEEPALIVE_KW) + 10;
    const e = env(strip(), { sun: (h) => (h < dark ? 0 : 1) });
    const s = newGame('test');
    land(s, e, '0,0', ['4,0']);
    const seen: string[] = [];
    for (let h = 0; h < dark + 5; h++) for (const ev of step(s, e).events) seen.push(`${ev.type}@${s.hour - 1}`);
    // Full battery lasts exactly its endurance, then one more hour cannot be paid for.
    expect(seen[0]).toBe(`sleep@${BATTERY_KWH / KEEPALIVE_KW}`);
    expect(seen[1]).toBe(`wake@${dark}`);
    expect(s.asleep).toBe(false);
    expect(s.sleepHours).toBe(dark - BATTERY_KWH / KEEPALIVE_KW);
  });

  it('takes no new orders while Earth is hidden', () => {
    const e = env(strip(), { earth: (h) => h >= 5 });
    const s = newGame('test');
    land(s, e, '0,0', ['4,0']);
    expect(orderRover(s, e, 1, { kind: 'prospect', target: '4,0' }).ok).toBe(false);
    for (let h = 0; h < 5; h++) step(s, e);
    expect(orderRover(s, e, 1, { kind: 'prospect', target: '4,0' }).ok).toBe(true);
    expect(orderRover(s, e, 1, { kind: 'haul', target: '3,0' }).ok).toBe(false); // not a dark spot
  });

  it('prospects, hauls, makes propellant and conserves mass', () => {
    const e = env(strip(), { ice: 0.056 });
    const s = newGame('test');
    land(s, e, '0,0', ['4,0']);
    expect(orderRover(s, e, 1, { kind: 'haul', target: '4,0' }).ok).toBe(false); // must prospect first
    orderRover(s, e, 1, { kind: 'prospect', target: '4,0' });
    let found = -1;
    for (let h = 0; h < 40 && found < 0; h++) {
      for (const ev of step(s, e).events) if (ev.type === 'prospected') found = ev.ice;
    }
    expect(found).toBeCloseTo(0.056, 12);
    for (let h = 0; h < 40; h++) step(s, e); // drive home
    expect(orderRover(s, e, 1, { kind: 'haul', target: '4,0' }).ok).toBe(true);

    for (let h = 0; h < 400; h++) step(s, e);
    expect(s.trips).toBeGreaterThan(5);
    const hauled = s.trips * ROVER_PAYLOAD_KG;
    expect(s.hopperKg + s.waterKg + s.h2Kg + s.o2Kg + s.tailingsKg).toBeCloseTo(hauled, 6);
    expect(s.o2Kg / s.h2Kg).toBeCloseTo(O2_PER_KG_WATER / H2_PER_KG_WATER, 6);
    expect(s.milestones).toEqual(expect.arrayContaining(['prospect', 'regolith', 'water']));
  });

  it('rover battery: never runs below empty, and far trips are refused', () => {
    const e = env(strip(), { ice: 0.056 });
    const s = newGame('test');
    land(s, e, '0,0', ['4,0']);
    orderRover(s, e, 1, { kind: 'prospect', target: '4,0' });
    let lowest = Infinity;
    for (let h = 0; h < 60; h++) {
      step(s, e);
      lowest = Math.min(lowest, s.rovers[0].chargeKWh);
    }
    expect(lowest).toBeGreaterThanOrEqual(0);
    // 4 km away and back, plus prospecting, uses exactly the trip energy.
    // It left full; the 4 km round trip plus prospecting used exactly the planned trip energy.
    expect(ROVER_BATTERY_KWH - lowest).toBeCloseTo(tripEnergyKWh(4, PROSPECT_HOURS), 6);

    // A strip long enough that the round trip needs more than one charge.
    const far = (ROVER_BATTERY_KWH / ROVER_KW) * ROVER_SPEED_KMH; // km of driving one charge allows
    const n = Math.ceil(far / 2) + 2;
    const long = Array.from({ length: n }, (_, i) => ({
      i, j: 0, dx_km: i, dy_km: 0, lat: -85, lon: 0, ground_m: 0, sunlit_pct: i === n - 1 ? 0 : 50, earth_pct: 50,
      both_pct: 25, longest_dark_h: 0, longest_blackout_h: 0,
    }));
    const el = env(long);
    expect(reachableDark(el, '0,0', [`${n - 1},0`])).toEqual([]);
    expect(land(newGame('t'), el, '0,0', [`${n - 1},0`]).ok).toBe(false);
  });

  it('rovers drive only with the Earth link, and only start trips that fit before Earth sets', () => {
    // Earth up for 6 hours, then gone for 20, then back: the 4 km prospect trip needs about 14 h.
    const earth = (h: number) => h < 6 || h >= 26;
    const e = env(strip(), { earth });
    const s = newGame('test');
    land(s, e, '0,0', ['4,0']);
    orderRover(s, e, 1, { kind: 'prospect', target: '4,0' });
    for (let h = 0; h < 26; h++) {
      step(s, e);
      expect(s.rovers[0].phase).not.toBe('out'); // never leaves into a window too short for the trip
    }
    let left = -1;
    for (let h = 26; h < 60 && left < 0; h++) {
      step(s, e);
      if (s.rovers[0].phase === 'out') left = h;
    }
    expect(left).toBe(26); // leaves as soon as the long window starts

    // A rover caught out when Earth sets parks: it does not move until Earth is back.
    const e2 = env(strip(), { earth: (h) => h < 30 || h >= 50 });
    const s2 = newGame('test');
    land(s2, e2, '0,0', ['4,0']);
    orderRover(s2, e2, 1, { kind: 'prospect', target: '4,0' });
    s2.rovers[0].phase = 'out';
    s2.rovers[0].route = ['1,0', '2,0', '3,0', '4,0'];
    s2.hour = 30;
    const at = s2.rovers[0].at;
    const leg = s2.rovers[0].legKm;
    for (let h = 30; h < 50; h++) step(s2, e2);
    expect(s2.rovers[0].at).toBe(at);
    expect(s2.rovers[0].legKm).toBe(leg);
  });

  it('Moon dirt builds pads (for rovers, towers and batteries) and a shelter; launch needs only fuel', () => {
    const e = env(strip(), { ice: 0.056 });
    const s = newGame('test');
    land(s, e, '0,0', ['4,0']);
    // Pads cost dirt and bring one delivery each.
    expect(buy(s, e, 'pad').ok).toBe(false);
    s.tailingsKg = 10_000;
    const pad1 = buildCost(s, e, 'pad')!;
    expect(buy(s, e, 'pad').ok).toBe(true);
    expect(s.tailingsKg).toBe(10_000 - pad1);
    expect(buildCost(s, e, 'pad')!).toBeGreaterThan(pad1); // each pad costs more
    expect(deliver(s, e, 'rover').ok).toBe(true);
    expect(s.rovers.map((r) => r.id)).toEqual([1, 2]);
    expect(deliver(s, e, 'rover').ok).toBe(false); // that pad is used
    buy(s, e, 'pad');
    expect(deliver(s, e, 'tower', '3,0').ok).toBe(false); // 3 km: beyond the cable
    expect(deliver(s, e, 'tower', '2,0').ok).toBe(true);
    expect(s.towers).toEqual(['0,0', '2,0']);
    // Shelter: once.
    expect(buy(s, e, 'shelter').ok).toBe(true);
    expect(buy(s, e, 'shelter').ok).toBe(false);
    // Battery pack: more storage, arrives charged.
    buy(s, e, 'pad');
    const cap = s.batteryCapKWh;
    expect(deliver(s, e, 'battery').ok).toBe(true);
    expect(s.batteryCapKWh).toBe(cap + BATTERY_PACK_KWH);
    expect(s.batteryKWh).toBe(s.batteryCapKWh);

    expect(launch(s).ok).toBe(false);
    s.h2Kg = TARGET.h2Kg;
    s.o2Kg = TARGET.o2Kg;
    expect(launch(s).ok).toBe(true); // no blast wall needed
    expect(s.launchedHour).toBe(s.hour);
  });

  it('the shelter saves night power', () => {
    const night = (shelter: boolean) => {
      const e = env(strip(), { sun: () => 0 });
      const s = newGame('test');
      land(s, e, '0,0', ['4,0']);
      s.shelter = shelter;
      s.rovers = [];
      for (let h = 0; h < 48; h++) step(s, e);
      return s.batteryCapKWh - s.batteryKWh;
    };
    expect(night(true)).toBeCloseTo(night(false) * SHELTER_KEEPALIVE_FACTOR, 9);
  });

  it('idle rovers scout the chosen crater, then all dig there', () => {
    const e = env(strip(), { ice: 0.056 });
    const s = newGame('test');
    land(s, e, '0,0', ['4,0']);
    s.tailingsKg = 10_000;
    buy(s, e, 'pad');
    deliver(s, e, 'rover');
    chooseCrater(s, e, '4,0');
    step(s, e);
    expect(s.rovers.filter((r) => r.job?.kind === 'prospect')).toHaveLength(1);
    for (let h = 0; h < 200 && s.trips < 2; h++) step(s, e);
    expect(s.rovers.every((r) => r.job?.kind === 'haul' && r.job.target === '4,0')).toBe(true);
  });
});
