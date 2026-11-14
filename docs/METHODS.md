# Methods

Physics write-up for the project page. Filled in at milestone 8.

## Site frame
TODO

## Ephemeris (SPICE) and lunar libration
- Positions of the Sun and Earth come from NASA/JPL's DE440 planetary
  ephemeris (`de440s.bsp`), read with SpiceyPy (the Python wrapper of NASA's
  SPICE toolkit).
- The Moon's orientation comes from the DE440 lunar orientation kernel
  (`moon_pa_de440_200625.bpc`) and frame kernel (`moon_de440_250416.tf`). We
  work in the `MOON_ME` (mean Earth / polar axis) body-fixed frame, the same
  frame LOLA maps and JPL Horizons use for lunar sites.
- **Libration** (the Moon's slow rocking as seen from Earth, which makes
  Earth wander a few degrees in the lunar sky) is not modelled separately: it
  is already in the orientation kernel, so it appears automatically.
- For each hour of 2027 we get the Sun and Earth positions from the Moon's
  center with light-time and stellar-aberration correction (`LT+S`), subtract
  the site position (1737.4 km sphere + ground height + 3 m mast), and express the direction
  in the site's local east/north/up frame.
- The site position includes the LOLA ground height (see Horizon masks).
- No atmosphere, so no refraction: directions are purely geometric.
- Validation against JPL Horizons: worst difference 0.095″ (see VALIDATION.md).

## Horizon masks from LOLA
- **Data:** LOLA south-pole elevation maps from NASA GSFC PGDA (Barker et al.
  2023, *Planetary Science Journal* 4, 183, doi:10.3847/PSJ/acf3e1). The
  20 m/pixel map (80–90°S) is used wherever it has data, the 240 m/pixel map
  (60–90°S) elsewhere. Heights are relative to a 1737.4 km sphere, in the
  MOON_ME frame (DE421), which matches the `MOON_ME` frame we use for the Sun
  and Earth.
- **Method:** from the observer (ground height + 3 m mast), for each of 360
  azimuths (1° steps, measured from the site's grid north), we walk outward
  along the surface from 0.1 km to 150 km: every 50 m up to 5 km, then in steps
  of 1% of the distance. At each step we look up the terrain height and compute
  the exact 3D elevation angle

  `elevation = asin( dot(P − O, up_O) / |P − O| )`

  where O is the observer and P the terrain point (vectors from the Moon's
  center) and `up_O = O/|O|`. The horizon at that azimuth is the largest
  angle found. This includes the Moon's curvature automatically. (For intuition:
  this is about `atan(Δh/d) − d/(2R)`.)
- **Ground height** at the site comes from the same map and is also used for
  the observer position in the Sun/Earth calculation.

## Visibility, sunlit fraction and flux
TODO

## Site Score
TODO: formula and weights. The weights are a design choice, not physics.
