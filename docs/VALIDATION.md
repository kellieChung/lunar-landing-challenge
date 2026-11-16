# Validation

## Site coordinates and sources

| id | name | lat | lon | source |
| --- | --- | --- | --- | --- |
| cabeus-b-peak | Peak near Cabeus B | -83.661 | -69.014 | — |
| haworth | Haworth | -86.80402 | -21.66710 | paper 2 (given as 338.33290° E) |
| malapert-massif | Malapert Massif | -85.995 | -0.236 | — |
| mons-mouton-plateau | Mons Mouton Plateau | -84.232 | 29.926 | — |
| mons-mouton | Mons Mouton | -85.423 | 31.586 | — |
| nobile-rim-1 | Nobile Rim 1 | -85.54419 | 37.62660 | paper 2 |
| nobile-rim-2 | Nobile Rim 2 | -84.20156 | 60.69989 | paper 1 |
| de-gerlache-rim-2 | de Gerlache Rim 2 | -88.51566 | -61.167319444 | paper 1 (given as 298.832680556° E) |
| slater-plain | Slater Plain | -87.149 | 126.134 | — |

Data is built for all nine sites: the four paper sites (Nobile Rim 1, Nobile
Rim 2, de Gerlache Rim 2, Haworth) plus Malapert Massif, Mons Mouton, Mons
Mouton Plateau, Peak near Cabeus B and Slater Plain (the team brief's values,
with no published source recorded). Peak near Cabeus B and Slater Plain have no 5 m tile; they are built
on 30 × 30 km, 10 m/pixel crops of `LDEM_83S_10MPP_ADJ` (`fetch_10mpp_crops.py`).

**Note: Peak near Cabeus B.** The brief's
coordinate (−83.661°, −69.014°) is on the peak's flank, not its top: a 17.5°
slope at 4259 m, with the summit (about 4600 m) 2–3 km to the northeast.
That ridge rises 10–12° above the center's horizon in Earth's direction, so
Earth is never visible from the center (0.0%); grid spot (2, 2), near the
summit, sees Earth 82.6% of the time and is sunlit 55.0%. When this was first
checked (with the original 0.1–150 km ray walk), the 20 m map alone gave the
same result (0.0% Earth, 30.0% sunlit), so this comes from the coordinate, not the 10 m data.

**Note: Mons Mouton Plateau.** The team's list
pairs it with the Mons Mouton tile (`Site20v2_final_adj_5mpp_surf.tif`), but
its coordinate (−84.232°, 29.926°) lies about 21 km outside that tile, which
is centered on Mons Mouton itself. It is built on the 20 m map.

**Resolved: de Gerlache Rim 2 longitude.** An earlier copy of the brief had
+61.16732°, where the site center is a deep low spot (ground −3,193 m, 0%
sunlit in 2027). Paper 1 gives 298.832680556° E, i.e. −61.167319444°: a rim
at +580 m, 18.6% sunlit, inside the team's 5 m tile for this site
(`SL2_final_adj_5mpp_surf.tif`). The data now uses the paper's value.

## 1. Horizon tests (synthetic terrain)

Tests in `python/tests/test_horizon.py`, observer at Nobile Rim 2, 3 m mast,
1737.4 km sphere. All pass.

| test | what it checks | expected | result |
| --- | --- | --- | --- |
| Smooth sphere | every azimuth shows the geometric dip `−acos(R/(R+h))` | −0.1065° | within 0.001° at all 360 azimuths |
| Cone mountain (1 km high, 4 km due north) | north value equals the exact 3D angle to the tip | exact 3D angle | within 1e-6°; the small-angle formula agrees within 0.05° |
| Cone, looking away | south shows only the sphere dip | −0.1065° | within 0.001° |
| Orientation | a peak placed at 0°, 90°, 180°, 270° shows up at that same azimuth | same index | pass (guards against a mirrored panorama) |
| Near/far maps | a peak only in the far map is seen where the near map has no data; a near-map peak wins over a flat far map | peak visible | pass |
| Missing data | samples with no data in either map are skipped, never treated as 0 m | skipped | pass |
| Map projection | our polar stereographic formula vs. GDAL/PROJ using each file's own CRS, 4 latitudes × 4 longitudes | same x, y | within 1 cm |
| Pixel lookup | sampling at a pixel center returns that pixel's raw value | raw value | within 1 mm |

### Elevation maps and their agreement

- **Site tiles:** LOLA 5 m/pixel tiles (`*_5mpp_surf.tif`), used where one
  reaches the site. de Gerlache Rim 2 uses `SL2_final_adj_5mpp_surf.tif`;
  its center is 0.9 km inside the tile's edge, so 72 of the 121 grid points
  and about half the terrain fall on it. **Seam check** along that edge
  (1 km band inside the tile, 37,972 points): 5 m − 20 m mean 0.09 m, median
  0.06 m, 95% of |differences| under 0.9 m, max 41 m (steep spots); the two
  maps share a datum. At the site center the 5 m map and finer near-field
  steps move the horizon by up to 0.9° (mean 0.1°) compared with the 20 m map.
  Nobile Rim 1 uses `Site06_final_adj_5mpp_surf.tif` (and the overlapping
  Mons Mouton tile `Site20v2` where Site06 ends; the site's own tile, nearest
  center first, always wins); Nobile Rim 2 uses `DM2_final_adj_5mpp_surf.tif`;
  Haworth uses `Haworth_final_adj_5mpp_surf.tif`; Malapert Massif uses
  `Site23_final_adj_5mpp_surf.tif`; Mons Mouton uses `Site20v2` (then Site06);
  Mons Mouton Plateau has no tile (see the flag above). Edge checks, 5 m − 20 m
  in the 1 km band: Site06 mean −0.08 m (95% under 1.0 m), Site20v2 mean
  0.00 m (95% under 0.8 m), DM2 mean 0.05 m (95% under 1.2 m), Site23 mean
  0.02 m (95% under 0.9 m), Haworth mean 0.05 m (95% under 0.8 m).
  Peak near Cabeus B and Slater Plain use 10 m/pixel crops
  (`cabeus-b-peak_10mpp_crop.tif`, `slater-plain_10mpp_crop.tif`), layered and
  feathered like the 5 m tiles; 10 m − 20 m in the 1 km band: Cabeus B mean
  0.04 m (95% under 0.5 m), Slater Plain mean 0.06 m (95% under 0.6 m). At
  their centers the crops move the horizon by at most 0.27° (Cabeus B) and
  0.10° (Slater Plain) and % sunlit by under 0.03 points versus the 20 m map.
  Switching to the 5 m tiles and 10 m steps moved the site centers' % sunlit by
  −0.6 (Nobile Rim 1), −0.8 (Nobile Rim 2) and −0.1 (Haworth) points.
- **Near map:** `LDEM_80S_20MPP_ADJ` (20 m/pixel). **Far map:** `LDEM_60S_240MPP_ADJ`
  (240 m/pixel). Both from NASA GSFC PGDA (Barker et al. 2023, *PSJ* 4, 183,
  doi:10.3847/PSJ/acf3e1). Heights in metres relative to a 1737.4 km sphere
  (the files' own datum), south polar stereographic.
- The near map is square, so its corners reach beyond 80°S. Around Nobile Rim
  2 it covers essentially the whole 150 km radius; the far map only fills the
  few spots at the window edge.
- **Seam check** (`python/scripts/check_dem_seam.py`): 199,990 random points
  within 150 km of Nobile Rim 2 where both maps have data. Near − far: mean
  −0.01 m, median 0.15 m, 95% of |differences| under 6.5 m, max 51 m (rough
  terrain the 240 m map smooths). No systematic offset, so both maps share
  the same reference and projection.

### Nobile Rim 2 horizon (site center, 3 m mast)

- Ground height: 1,122 m above the 1737.4 km sphere.
- Horizon from −1.82° (azimuth 170°) to +7.10° (azimuth 302°).
- The highest ridge (northwest, around 300°) is in the same direction as
  Earth (azimuth about 291°–307° over 2027), so terrain hides Earth much of
  the time.
- Computing one 360° mask takes about 0.02 s (design target: under 2 s);
  loading the two map windows takes about 3.5 s per site.

### Grid points (11 × 11, 1 km apart)

Tests in `python/tests/test_grid.py` and `test_shipped_site.py`. All pass.

| test | what it checks | result |
| --- | --- | --- |
| Positions | the center maps back to the site; 1 km east is 1.000 km away, due east | within 1 cm |
| Up tilt | each point's up leans toward its offset by d / (R + ground) | within 1e-7 |
| Rotation into a point's frame | orthonormal, unit vectors stay unit, identity at the center; the center's zenith seen from 5 km east is 0.165° lower, due west | within 1e-14 |
| Smooth sphere from an off-center point | geometric dip at all azimuths (site-frame azimuths) | within 0.001° |
| Mountain seen from an off-center point | the mask's peak and the exact direction to the summit (rotated into the point's frame) agree | same azimuth within 1°, elevation within 0.1° (cone tip between 1° samples) |
| Heightmap vs grid | every grid point sits on a heightmap vertex at its own ground height | within 0.15 m |
| Python ↔ TypeScript | year metrics at off-center points, recomputed in the browser from the file | within 1e-6 |

Full year 2027, 3 m mast. "Best spot" gives grid (i, j): i km east, j km north of the center.

| site | center ground | center sunlit | grid min | grid max (best spot) | center Earth visible | grid Earth visible | grid ground |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nobile-rim-1 | 6119 m | 77.8% | 0.0% | 77.8% (0, 0) | 60.0% | 0.0–63.3% | 3833 to 6175 m |
| nobile-rim-2 | 1121 m | 32.1% | 0.0% | 51.9% (−3, 2) | 24.5% | 0.0–75.2% | −605 to 1453 m |
| de-gerlache-rim-2 | 580 m | 18.6% | 0.0% | 82.1% (−5, −5) | 49.9% | 0.0–55.0% | −219 to 1812 m |
| haworth | 1819 m | 48.7% | 0.0% | 50.3% (2, 1) | 60.5% | 0.0–65.1% | 1124 to 1929 m |
| malapert-massif | 4784 m | 27.0% | 22.0% | 65.5% (1, 0) | 46.9% | 0.0–100.0% | 3110 to 5169 m |
| mons-mouton | 6400 m | 40.3% | 0.0% | 76.0% (−5, −2) | 67.5% | 0.0–99.4% | 4997 to 6422 m |
| mons-mouton-plateau | 5077 m | 36.6% | 0.0% | 51.3% (−3, 2) | 100.0% | 0.0–100.0% | 4566 to 5536 m |
| cabeus-b-peak | 4259 m | 29.8% | 3.2% | 55.0% (2, 2) | 0.0% | 0.0–82.6% | 2098 to 4579 m |
| slater-plain | 23 m | 3.7% | 0.0% | 57.4% (2, −3) | 36.7% | 0.0–43.7% | −527 to 525 m |

Each site has spots that never see the Sun within 5 km of its center: small
craters and pits next to the high ground. Moving a lander 1 km can change
the sunlit share by tens of percent.

### 1b. Is the ray walk fine enough? (convergence check)

Site centers, 2027, each setting changed on its own against the original
walk (0.1–150 km, 1° azimuths, 1% far steps):

| change | effect on % sunlit | notes |
| --- | --- | --- |
| far steps 1% → 0.2% | at most 0.04 points (6 sites) | horizon rises by at most 0.05° |
| azimuths 1° → 0.25° | at most 0.06 points | interpolating the 1° mask is off by 0.01° rms, 0.10° worst |
| hourly → 10-minute samples | at most 0.03 points | longest night within 1 h |
| 9-point Sun disk → 432 points | mean disk fraction within 0.0002 | lit / dark agrees for 99.99% of hours |
| range 150 → 500 km | −0.46 points at Nobile Rim 1, −0.06 Malapert, 0 at low sites | horizon up to 0.63° higher; farthest horizon point 201 km (Mons Mouton). **Adopted: 250 km**; 250 → 500 km then changes nothing at any of the nine centers (≤ 0.005°, ≤ 0.02 points) |
| start 100 m → 10 m | usually 0; worst spots −2.9 points sunlit (Cabeus B), −13.8 points Earth (one Mons Mouton spot) | **Adopted: 10 m** |


### 1c. Raising the mast (site centers, 2027)

Extra horizon masks for every grid point at 5, 10, 20 and 30 m
(`<site>_mast<h>.json`), with antenna and panel at the same height. The
table shows the site centers. Each cell: % sunlit / % Earth
visible / longest night. Tests check that a taller mast never raises the
horizon and never loses Sun or Earth at any of the 121 points, and that the
browser recomputes the same numbers (`web/src/physics/mast.test.ts`).

| site | 3 m | 5 m | 10 m | 20 m | 30 m |
| --- | --- | --- | --- | --- | --- |
| cabeus-b-peak | 29.8% / 0.0% / 568 h | 30.5% / 0.0% / 565 h | 32.4% / 0.0% / 548 h | 35.7% / 0.0% / 525 h | 37.6% / 0.0% / 511 h |
| haworth | 48.7% / 60.5% / 421 h | 49.2% / 60.7% / 420 h | 49.7% / 61.0% / 419 h | 51.1% / 61.7% / 416 h | 52.5% / 62.3% / 412 h |
| malapert-massif | 27.0% / 46.9% / 2807 h | 36.2% / 48.7% / 2797 h | 46.4% / 53.2% / 675 h | 58.0% / 61.2% / 399 h | 64.0% / 67.2% / 348 h |
| mons-mouton-plateau | 36.6% / 100.0% / 464 h | 36.8% / 100.0% / 462 h | 37.3% / 100.0% / 459 h | 38.2% / 100.0% / 453 h | 39.1% / 100.0% / 445 h |
| mons-mouton | 40.3% / 67.5% / 525 h | 44.3% / 72.7% / 520 h | 50.9% / 81.6% / 509 h | 64.8% / 87.9% / 489 h | 73.3% / 96.8% / 467 h |
| nobile-rim-1 | 77.8% / 60.0% / 317 h | 80.0% / 61.1% / 306 h | 82.9% / 61.3% / 224 h | 83.1% / 61.6% / 223 h | 83.3% / 61.9% / 223 h |
| nobile-rim-2 | 32.1% / 24.5% / 540 h | 33.4% / 24.9% / 502 h | 34.7% / 25.7% / 487 h | 36.3% / 27.3% / 476 h | 37.8% / 28.7% / 468 h |
| de-gerlache-rim-2 | 18.6% / 49.9% / 703 h | 19.7% / 49.9% / 695 h | 21.4% / 49.9% / 688 h | 22.2% / 50.0% / 686 h | 22.6% / 50.0% / 683 h |
| slater-plain | 3.7% / 36.7% / 4941 h | 3.8% / 36.7% / 4940 h | 4.0% / 36.9% / 4937 h | 4.5% / 37.0% / 4908 h | 4.9% / 37.2% / 4904 h |

The biggest effect is at Malapert Massif. Part of its 3 m horizon is set by
ground under 100 m away (only a few metres higher than the site), so a
10 m mast cuts the 2027 longest night from about 117 days to 28. The 3 m
figure is knife-edge (see §4), but the size of the change is not.
The Sun/Earth vectors are the 3 m ones (raising the eye 27 m moves Earth's
direction by about 4e-6°).

## 2. Ephemeris vs JPL Horizons

Our Sun and Earth directions (SPICE, DE440, `MOON_ME`, `LT+S`) compared with
NASA JPL Horizons (DE441, `MEAN_ME` high-precision lunar frame, airless
apparent az/el) for an observer 3 m above the 1737.4 km reference sphere.
3 points × 5 moments × 2 bodies = 30 comparisons.

Points: **nobile-rim-2** is Nobile Rim 2 (−84.20156°, 60.69989°).
**test-equator** (0°, 0°) and **test-near-pole** (−89.5°, 0°) are math test
points only, not landing sites.

**Result: worst disagreement 0.095 arcseconds (0.000026°), median 0.005″.**
The design target was "well under 0.1°", so we're about 4,000× inside it. The
small Earth differences (≤ 0.1″) are not investigated further; likely causes
are Horizons using DE441 (we use DE440) and small differences in how
light-time and aberration are applied.

Reproduce: `python/.venv/bin/python python/scripts/validate_horizons.py`
(Horizons values are stored in `python/tests/fixtures/horizons_2027.json`,
fetched by `python/scripts/fetch_horizons.py`.)

| point | time (UTC) | body | Horizons az / el (°) | ours az / el (°) | Δaz (″) | Δel (″) | separation (″) |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| nobile-rim-2 | 2027-01-01 00:00 | Sun | 202.4802 / -4.3458 | 202.4802 / -4.3458 | 0.000 | 0.000 | 0.000 |
| nobile-rim-2 | 2027-03-20 06:00 | Sun | 330.0995 / 4.0218 | 330.0995 / 4.0218 | -0.000 | -0.000 | 0.000 |
| nobile-rim-2 | 2027-06-15 12:00 | Sun | 345.2970 / 4.4197 | 345.2970 / 4.4197 | -0.000 | -0.000 | 0.000 |
| nobile-rim-2 | 2027-09-23 18:00 | Sun | 201.0002 / -4.2211 | 201.0002 / -4.2211 | 0.000 | -0.000 | 0.000 |
| nobile-rim-2 | 2027-12-31 23:00 | Sun | 73.1782 / 2.3163 | 73.1782 / 2.3163 | -0.000 | 0.000 | 0.000 |
| nobile-rim-2 | 2027-01-01 00:00 | Earth | 306.8327 / -2.7856 | 306.8327 / -2.7855 | -0.001 | 0.089 | 0.089 |
| nobile-rim-2 | 2027-03-20 06:00 | Earth | 301.0316 / 1.4833 | 301.0316 / 1.4833 | -0.001 | -0.046 | 0.046 |
| nobile-rim-2 | 2027-06-15 12:00 | Earth | 305.4237 / -3.5815 | 305.4237 / -3.5815 | -0.001 | -0.057 | 0.057 |
| nobile-rim-2 | 2027-09-23 18:00 | Earth | 294.5463 / 6.0359 | 294.5463 / 6.0359 | -0.002 | 0.094 | 0.094 |
| nobile-rim-2 | 2027-12-31 23:00 | Earth | 297.8402 / 5.0983 | 297.8402 / 5.0983 | -0.002 | -0.063 | 0.063 |
| test-equator | 2027-01-01 00:00 | Sun | 268.9780 / -6.8839 | 268.9780 / -6.8839 | 0.000 | 0.000 | 0.000 |
| test-equator | 2027-03-20 06:00 | Sun | 88.0380 / 59.1094 | 88.0380 / 59.1094 | -0.000 | 0.003 | 0.004 |
| test-equator | 2027-06-15 12:00 | Sun | 88.3483 / 43.9492 | 88.3483 / 43.9492 | -0.000 | 0.002 | 0.000 |
| test-equator | 2027-09-23 18:00 | Sun | 268.7927 / -8.3536 | 268.7927 / -8.3536 | 0.000 | 0.000 | 0.000 |
| test-equator | 2027-12-31 23:00 | Sun | 90.8728 / -43.7324 | 90.8728 / -43.7324 | 0.000 | -0.002 | 0.000 |
| test-equator | 2027-01-01 00:00 | Earth | 49.9819 / 80.6103 | 49.9819 / 80.6103 | -0.027 | 0.020 | 0.020 |
| test-equator | 2027-03-20 06:00 | Earth | 54.7854 / 87.8433 | 54.7853 / 87.8433 | -0.105 | 0.005 | 0.005 |
| test-equator | 2027-06-15 12:00 | Earth | 40.3694 / 81.1874 | 40.3694 / 81.1874 | -0.035 | -0.004 | 0.007 |
| test-equator | 2027-09-23 18:00 | Earth | 227.8458 / 84.2019 | 227.8459 / 84.2019 | 0.048 | 0.003 | 0.005 |
| test-equator | 2027-12-31 23:00 | Earth | 202.8467 / 87.1477 | 202.8467 / 87.1477 | 0.147 | -0.006 | 0.009 |
| test-near-pole | 2027-01-01 00:00 | Sun | 263.1071 / 0.9539 | 263.1071 / 0.9539 | -0.000 | -0.000 | 0.000 |
| test-near-pole | 2027-03-20 06:00 | Sun | 30.8719 / -0.5787 | 30.8719 / -0.5787 | -0.000 | 0.000 | 0.000 |
| test-near-pole | 2027-06-15 12:00 | Sun | 46.0320 / -0.8426 | 46.0320 / -0.8426 | -0.000 | 0.000 | 0.000 |
| test-near-pole | 2027-09-23 18:00 | Sun | 261.6352 / 1.1211 | 261.6352 / 1.1211 | -0.000 | -0.000 | 0.000 |
| test-near-pole | 2027-12-31 23:00 | Sun | 133.7381 / 0.2843 | 133.7381 / 0.2843 | 0.000 | 0.000 | 0.000 |
| test-near-pole | 2027-01-01 00:00 | Earth | 7.1793 / -5.7524 | 7.1793 / -5.7524 | -0.001 | 0.089 | 0.089 |
| test-near-pole | 2027-03-20 06:00 | Earth | 1.7537 / -1.0090 | 1.7537 / -1.0090 | -0.001 | -0.046 | 0.046 |
| test-near-pole | 2027-06-15 12:00 | Earth | 5.7031 / -6.4285 | 5.7031 / -6.4285 | -0.000 | -0.057 | 0.057 |
| test-near-pole | 2027-09-23 18:00 | Earth | 355.7124 / 4.1016 | 355.7124 / 4.1016 | -0.002 | 0.095 | 0.095 |
| test-near-pole | 2027-12-31 23:00 | Earth | 358.8961 / 2.8719 | 358.8961 / 2.8718 | -0.002 | -0.063 | 0.063 |

## 3. Sanity checks

Full year 2027, hourly, elevations relative to a flat horizon (no terrain).

| point | Sun elevation range | Earth elevation range | notes |
| --- | --- | --- | --- |
| nobile-rim-2 (−84.2°) | −7.34° to +7.35° | −3.71° to +8.82° | Earth often below the flat horizon: comms blackouts even without mountains |
| test-near-pole (−89.5°) | −2.02° to +2.02° | −6.60° to +7.07° | Sun stays within ~2° of the horizon |
| test-equator (0°, 0°) | −89.95° to +89.60° | +79.69° to +89.97° | Earth parked near the zenith |

- **Correction to the original brief:** it said pole sites keep the Sun within about
  ±1.6°. That only holds right at the pole. In general the Sun's elevation is
  bounded by *(distance from the pole) + ~1.5°* (the tilt of the Moon's axis),
  so Nobile Rim 2, about 6° from the pole, sees the Sun up to about 7.3°. The
  test uses that latitude-dependent bound.
- **Libration (equator point):** Earth wanders −7.76° to +7.65° east–west and
  −6.86° to +6.88° north–south around the zenith. This matches the commonly
  quoted lunar libration of about 7.9° in longitude and 6.9° in latitude.
- No far-side point ("Earth never visible") is tested.

## 4. Long-term averages, published illumination and eclipses

Reproduce all tables here: `python/.venv/bin/python python/scripts/validate_multiyear.py`

### 2027 against 2026–2044 (site centers, 3 m mast, 6-hour step)

Published illumination values are long-term averages. The Moon's orbit takes
18.6 years to return to the same tilt, so we ran 19 years. "Any part of the
Sun" counts a sample as lit when at least one of the 9 disk points is up,
the usual definition in published maps; ours ("sunlit") needs half the disk.

| site | sunlit 2027 | sunlit 2026–2044 (min / mean / max per year) | any part of the Sun, mean | Earth 2027 | Earth 2026–2044 (min / mean / max) | longest night in 19 y |
| --- | --- | --- | --- | --- | --- | --- |
| cabeus-b-peak | 29.8% | 27.3 / 28.2 / 29.9% | 29.5% | 0.0% | 0.0 / 0.0 / 0.0% | 570 h |
| haworth | 48.7% | 46.3 / 48.4 / 50.5% | 50.9% | 60.5% | 56.1 / 60.2 / 64.7% | 426 h |
| malapert-massif | 27.0% | 24.7 / 26.3 / 28.6% | 29.7% | 46.9% | 44.5 / 48.5 / 53.3% | 3486 h |
| mons-mouton-plateau | 36.6% | 36.6 / 37.7 / 39.4% | 38.1% | 100.0% | 93.6 / 98.5 / 100.0% | 468 h |
| mons-mouton | 40.3% | 38.8 / 40.6 / 42.6% | 42.7% | 67.5% | 66.8 / 70.7 / 74.6% | 528 h |
| nobile-rim-1 | 77.8% | 74.1 / 76.8 / 77.9% | 79.3% | 60.0% | 56.8 / 60.9 / 65.0% | 318 h |
| nobile-rim-2 | 32.1% | 31.2 / 32.3 / 34.2% | 33.3% | 24.5% | 23.5 / 27.0 / 31.3% | 546 h |
| de-gerlache-rim-2 | 18.6% | 18.0 / 18.9 / 21.2% | 20.4% | 49.9% | 49.2 / 52.4 / 58.2% | 2112 h |
| slater-plain | 3.7% | 3.3 / 3.7 / 4.3% | 4.3% | 36.7% | 34.2 / 38.0 / 42.9% | 5622 h |

**Knife-edge long nights.** The 19-year longest nights at de Gerlache Rim 2
(2112 h, from June 2041) and Malapert Massif (3486 h) are several monthly
nights joined because the Sun's brief monthly peek no longer clears the
horizon. With the original ray walk (starting 100 m out) the Sun's center
cleared it by 0.42° (de Gerlache, 18 h) and 0.08° (Malapert, 18 h) and split
these nights (de Gerlache then: 702 h). Ground 75–80 m from the mast now
blocks it, by just 0.02° at de Gerlache and 0.15° at Malapert. That is inside
our 0.10° interpolation error and the map's own accuracy, so treat these
numbers (and Malapert's 2807 h in 2027) as "one to four months, depending on
a few metres of ground right beside the lander", not as precise values.

2027 is a typical year for sunlight (within about 1 point of the mean, 1.6
at Cabeus B) but a below-average year for Earth visibility at most sites
(up to 3.2 points under the mean).

### A published point: the Shackleton–de Gerlache connecting ridge

One-off check with the 20 m map (no 5 m tile loaded), old 150 km range: the
best spot within 1.5 km of (−89.45°, 222.69° E), found at (−89.473°,
222.69° E), ground 1949 m, over 2026–2044:

| mast | sunlit (half the disk) | any part of the Sun | longest night |
| --- | --- | --- | --- |
| 2 m | 86.6% | 89.8% | 132 h |
| 10 m | 90.0% | 92.8% | 102 h |

This is the area Mazarico et al. (2011, *Icarus* 211, 1066) report as the
most illuminated near the south pole. Their published percentages are not
compared here.

### Eclipses of the Sun by Earth (seen from Nobile Rim 1, 10-minute step)

| eclipse begins (UTC) | lasts | most of the Sun covered | fully covered for |
| --- | --- | --- | --- |
| 2026-03-03 09:30 | 4.2 h | 100% | 1.2 h |
| 2026-08-28 02:00 | 4.8 h | 100% | 2.5 h |
| 2027-08-17 05:50 | 3.2 h | 45% | 0.0 h |
| 2028-01-12 02:30 | 3.7 h | 100% | 0.7 h |
| 2028-07-06 17:10 | 2.7 h | 34% | 0.0 h |
| 2028-12-31 14:30 | 4.8 h | 100% | 2.5 h |
| 2029-06-26 01:20 | 4.5 h | 100% | 2.5 h |
| 2029-12-20 20:30 | 4.5 h | 100% | 1.2 h |
| 2030-06-15 16:40 | 4.0 h | 100% | 2.0 h |

**Checked against NASA's lunar eclipse catalogue** (F. Espenak, GSFC,
eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html): all nine dates are lunar
eclipses there, and each catalogue time of greatest eclipse falls inside our
window. The catalogue also lists three penumbral eclipses we don't flag:
2027 Feb 20, 2027 Jul 18 and 2030 Dec 09. Checking them with SPICE at the
catalogue's greatest-eclipse times shows why they don't reach the south pole:

| eclipse (catalogue) | Sun covered at the south pole | at the north pole | at the sub-Earth point |
| --- | --- | --- | --- |
| 2027 Feb 20, penumbral | 0% (misses by 0.05°) | 95% | 36% |
| 2027 Jul 18, penumbral (grazing) | 0% (misses by 0.50°) | 0% (misses by 0.01°) | 0% |
| 2030 Dec 09, penumbral | 0% (misses by 0.04°) | 87% | 32% |
| 2027 Aug 17, penumbral (we flag it) | 45% | 0% | 0% |

In the first and third, the Moon passes north of Earth's shadow, so only its
northern part is in the penumbra; on 17 August 2027 it passes south, so the
south pole gets the deepest part (seen from the Moon, Earth covers 45% of
the Sun there, while the catalogue still calls it penumbral because no part
of the Moon reaches the umbra). So at the south-pole sites 2027 has exactly
one eclipse: 17 August.

## 5. Python ↔ TypeScript parity

The browser recomputes all metrics itself, so it must agree with Python.
`python/scripts/make_metrics_fixture.py` writes
`python/tests/fixtures/metrics_parity.json` with its own inputs and the
Python answers; `python/tests/test_metrics.py` and
`web/src/physics/metrics.test.ts` both recompute and compare. All pass.

| case | what is compared | tolerance | result |
| --- | --- | --- | --- |
| Nobile Rim 2, 1,000 h (2 sunrises/sunsets, 2 Earthrises/sets) | sunlit fraction per hour | 1e-12 (exact ninths) | pass |
| same | Earth margin per hour | 1e-9° | pass |
| same, 3 windows | hour counts, longest night / blackout | exact | pass |
| same, 3 windows | % sunlit / Earth / both, mean fraction | 1e-9 | pass |
| same, 3 windows | mean flux per panel type | 1e-6 W/m² | pass |
| same, 7 queries | next sunrise / sunset / Earthrise / Earthset | 1e-6 h (< 4 ms) | pass |
| Synthetic: Sun crossing a ridge at north (azimuth 359° → 0°) | all of the above | same | pass |
| Nobile Rim 1, 80 h around the 2027-08-17 eclipse | eclipse share per hour, window flux | 1e-12 / 1e-6 W/m² | pass |
| Shipped `nobile-rim-2.json`, all 8,760 h | browser year metrics vs `precomputed.center.year` (rounded to 6 decimals) | 1e-6 | pass |

Nobile Rim 2 site center, 2027, 3 m mast (from the shipped file):

| sunlit | mean fraction | Earth visible | both | longest night | longest blackout | mean flux: tracking / vertical / flat |
| --- | --- | --- | --- | --- | --- | --- |
| 32.1% | 0.32 | 24.5% | 7.5% | 540 h (22.5 d) | 496 h (20.7 d) | 437 / 436 / 33 W/m² |

## Limits

- **Map resolution:** 5 m/pixel inside site tiles, 20 m/pixel near field
  elsewhere, 240 m far field. Features
  smaller than that (boulders, small craters) are not in the horizon.
- **Closest 10 m:** the ray walk starts 10 m from the mast. Rocks and bumps
  closer than that, and the lander itself, are not in the horizon.
- **Distant sampling:** beyond 5 km, samples are spaced at 1% of the distance
  (about 1 km apart at 100 km), so a narrow distant peak can fall between
  samples. This was a design choice.
- **Fixed 250 km range:** terrain further away is ignored. Rerunning all nine
  site centers out to 500 km changes no mask value by more than the 0.005°
  rounding (see §1b).
- **One year (2027):** yearly numbers drift over the 18.6-year cycle (§4).
- **Eclipses** scale the power but not "lit"; Earth's atmosphere is ignored.
- **Grid points share the center's Sun/Earth directions:** moving 7 km
  shifts the direction to Earth by at most 0.001° (and the Sun far less).
  Each point's own "up" is accounted for exactly.
- **Mast height:** 3 m for both solar panel and antenna by default; 5, 10, 20
  and 30 m at every grid spot (§1c), nothing in between.
- **1-hour sampling:** statistics count whole hours. Rise and set times are
  refined to well under a second between samples, but a rise and set that
  both fall inside the same hour are missed.
- **Battery and signal icons** use simple display rules (instant recharge,
  192 h battery, bar thresholds), described in METHODS.md.
