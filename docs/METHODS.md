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
  the site position (1737.4 km sphere + 3 m mast), and express the direction
  in the site's local east/north/up frame.
- The ground height at the site is not included yet (milestone 3). Leaving it
  out changes the directions by less than 0.001°.
- No atmosphere, so no refraction: directions are purely geometric.
- Validation against JPL Horizons: worst difference 0.095″ (see VALIDATION.md).

## Horizon masks from LOLA
TODO

## Visibility, sunlit fraction and flux
TODO

## Site Score
TODO: formula and weights. The weights are a design choice, not physics.
