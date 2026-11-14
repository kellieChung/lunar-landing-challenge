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

## 3D view (rendering only)
The 3D view only *shows* the physics. Whether the Sun is lit or Earth is
visible always comes from the horizon mask (`src/physics/visibility.ts`); if
the picture and the numbers ever disagree, the numbers are right.
- **Layered skyline rings:** the same ray walk that builds the horizon mask
  also keeps the highest angle within three distance bands (0–5, 5–30 and
  30–150 km). Each band is drawn as a curtain around the viewer, far to near,
  so the top edge you see is the maximum of the three, which is exactly the
  physics horizon.
- **Near terrain:** a 10 × 10 km heightmap (101 × 101 points, 100 m apart)
  around the site from the same LOLA maps. Heights are measured along the
  site's "up" direction, so they include the Moon's curvature (flat ground
  5 km away sits about 7 m lower). Any point drawn above the physics horizon
  is lowered onto it (a handful of points, because the mesh is coarser than
  the ray walk), so the mesh can never hide a Sun the physics says is up.
- **Vertical exaggeration:** every height is stretched by the same factor k
  around the viewer's eye. An elevation angle *el* is then shown at
  `atan(k · tan el)`. This keeps the order of things at every azimuth (a Sun
  above a ridge is drawn above it), keeps the mesh, rings and shadows
  consistent with each other, and k = 1 is exact true scale. k is chosen per
  site: the largest value up to 10× that fits the whole year's horizon, Sun
  and Earth in a 60° view (about 5× at Nobile Rim 2).
- **Lighting:** one light along the Sun direction casts the shadows on the
  near terrain. The rings cast no shadows, so the light is switched off when
  the physics mask (5–150 km bands) says a distant ridge hides the Sun.
- **Sun and Earth** are drawn at their true angular size (Earth about 3.6×
  wider than the Sun). Earth's lit fraction is the true one,
  `(1 − cos θ)/2` with θ the Sun–Earth angle seen from the site.
- **Known limitation:** at k > 1 the disks stay round while their positions
  are stretched, so how much of a half-hidden Sun you *see* is approximate.
  It is exact in "True scale" mode, and the numbers never depend on it.

## Visibility, sunlit fraction and flux
TODO

## Site Score
TODO: formula and weights. The weights are a design choice, not physics.
