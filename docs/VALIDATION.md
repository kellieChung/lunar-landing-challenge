# Validation

Filled in as each milestone lands.

## Site coordinates and sources

| id | lat | lon | source |
| --- | --- | --- | --- |
| artemis-candidate (Nobile Rim 2) | -84.20156 | 60.69989 | TODO(astronomer): cite |
| apollo-11 | TODO | TODO | TODO(astronomer) |
| chandrayaan-3 | TODO | TODO | TODO(astronomer) |
| im-1 | TODO | TODO | TODO(astronomer) |
| shackleton-ridge | TODO | TODO | TODO(astronomer) |
| shackleton-floor | TODO | TODO | TODO(astronomer) |
| change-4 | TODO | TODO | TODO(astronomer) |

## 1. Horizon tests (synthetic terrain)

Tests in `python/tests/test_horizon.py`, observer at Nobile Rim 2, 3 m mast,
1737.4 km sphere. All pass.

| test | what it checks | expected | result |
| --- | --- | --- | --- |
| Smooth sphere | every azimuth shows the geometric dip `−acos(R/(R+h))` | −0.0586° | within 0.001° at all 360 azimuths |
| Cone mountain (1 km high, 4 km due north) | north value equals the exact 3D angle to the tip | exact 3D angle | within 1e-6°; spec's small-angle formula agrees within 0.05° |
| Cone, looking away | south shows only the sphere dip | −0.0586° | within 0.001° |
| Orientation | a peak placed at 0°, 90°, 180°, 270° shows up at that same azimuth | same index | pass (guards against a mirrored panorama) |
| Near/far maps | a peak only in the far map is seen where the near map has no data; a near-map peak wins over a flat far map | peak visible | pass |
| Missing data | samples with no data in either map are skipped, never treated as 0 m | skipped | pass |
| Map projection | our polar stereographic formula vs. GDAL/PROJ using each file's own CRS, 4 latitudes × 4 longitudes | same x, y | within 1 cm |
| Pixel lookup | sampling at a pixel center returns that pixel's raw value | raw value | within 1 mm |

### Elevation maps and their agreement

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
- Horizon from −1.82° (azimuth 170°) to +7.09° (azimuth 303°).
- The highest ridge (northwest, around 300°) is in the same direction as
  Earth (azimuth about 291°–307° over 2027), so terrain hides Earth much of
  the time. Detailed percentages come with the metrics in milestone 4.
- Computing one 360° mask takes about 0.02 s (spec target: under 2 s);
  loading the two map windows takes about 3.5 s per site.

## 2. Ephemeris vs JPL Horizons

Our Sun and Earth directions (SPICE, DE440, `MOON_ME`, `LT+S`) compared with
NASA JPL Horizons (DE441, `MEAN_ME` high-precision lunar frame, airless
apparent az/el) for an observer 3 m above the 1737.4 km reference sphere.
3 points × 5 moments × 2 bodies = 30 comparisons.

Points: **artemis-candidate** is Nobile Rim 2 (−84.20156°, 60.69989°).
**test-equator** (0°, 0°) and **test-near-pole** (−89.5°, 0°) are math test
points only, not landing sites.

**Result: worst disagreement 0.095 arcseconds (0.000026°), median 0.005″.**
The spec target was "well under 0.1°", so we're about 4,000× inside it. The
small Earth differences (≤ 0.1″) are not investigated further; likely causes
are Horizons using DE441 (we use DE440) and small differences in how
light-time and aberration are applied.

Reproduce: `python/.venv/bin/python python/scripts/validate_horizons.py`
(Horizons values are stored in `python/tests/fixtures/horizons_2027.json`,
fetched by `python/scripts/fetch_horizons.py`.)

| point | time (UTC) | body | Horizons az / el (°) | ours az / el (°) | Δaz (″) | Δel (″) | separation (″) |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| artemis-candidate | 2027-01-01 00:00 | Sun | 202.4802 / -4.3458 | 202.4802 / -4.3458 | 0.000 | 0.000 | 0.000 |
| artemis-candidate | 2027-03-20 06:00 | Sun | 330.0995 / 4.0218 | 330.0995 / 4.0218 | -0.000 | -0.000 | 0.000 |
| artemis-candidate | 2027-06-15 12:00 | Sun | 345.2970 / 4.4197 | 345.2970 / 4.4197 | -0.000 | -0.000 | 0.000 |
| artemis-candidate | 2027-09-23 18:00 | Sun | 201.0002 / -4.2211 | 201.0002 / -4.2211 | 0.000 | -0.000 | 0.000 |
| artemis-candidate | 2027-12-31 23:00 | Sun | 73.1782 / 2.3163 | 73.1782 / 2.3163 | -0.000 | 0.000 | 0.000 |
| artemis-candidate | 2027-01-01 00:00 | Earth | 306.8327 / -2.7856 | 306.8327 / -2.7855 | -0.001 | 0.089 | 0.089 |
| artemis-candidate | 2027-03-20 06:00 | Earth | 301.0316 / 1.4833 | 301.0316 / 1.4833 | -0.001 | -0.046 | 0.046 |
| artemis-candidate | 2027-06-15 12:00 | Earth | 305.4237 / -3.5815 | 305.4237 / -3.5815 | -0.001 | -0.057 | 0.057 |
| artemis-candidate | 2027-09-23 18:00 | Earth | 294.5463 / 6.0359 | 294.5463 / 6.0359 | -0.002 | 0.094 | 0.094 |
| artemis-candidate | 2027-12-31 23:00 | Earth | 297.8402 / 5.0983 | 297.8402 / 5.0983 | -0.002 | -0.063 | 0.063 |
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
| artemis-candidate (−84.2°) | −7.34° to +7.35° | −3.71° to +8.82° | Earth often below the flat horizon: comms blackouts even without mountains |
| test-near-pole (−89.5°) | −2.02° to +2.02° | −6.60° to +7.07° | Sun stays within ~2° of the horizon |
| test-equator (0°, 0°) | −89.95° to +89.60° | +79.69° to +89.97° | Earth parked near the zenith |

- **Spec correction:** the spec said pole sites keep the Sun within about
  ±1.6°. That only holds right at the pole. In general the Sun's elevation is
  bounded by *(distance from the pole) + ~1.5°* (the tilt of the Moon's axis),
  so Nobile Rim 2, about 6° from the pole, sees the Sun up to about 7.3°. The
  test uses that latitude-dependent bound. `TODO(astronomer)`: confirm and cite
  the ~1.54° axis tilt.
- **Libration (equator point):** Earth wanders −7.76° to +7.65° east–west and
  −6.86° to +6.88° north–south around the zenith. This matches the commonly
  quoted lunar libration of about 7.9° in longitude and 6.9° in latitude.
  `TODO(astronomer)`: confirm and cite.
- Far-side check ("Earth never visible") waits for the Chang'e-4 coordinates.

## 4. Published illumination
TODO(astronomer): papers and points.

## 5. Python ↔ TypeScript parity
TODO (milestone 4)

## Limits

- **Map resolution:** 20 m/pixel near field, 240 m far field. Features
  smaller than that (boulders, small craters) are not in the horizon.
- **Distant sampling:** beyond 5 km, samples are spaced at 1% of the distance
  (about 1 km apart at 100 km), so a narrow distant peak can fall between
  samples. This follows the spec's design.
- **Fixed 150 km range:** terrain further away is ignored.
- **Mast height:** one fixed 3 m observer height for both solar panel and
  antenna.
- TODO: 1-hour time sampling and Site Score weights (milestones 4 and 6).
