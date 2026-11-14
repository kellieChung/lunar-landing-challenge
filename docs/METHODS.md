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
  and Earth in 80% of the view height (about 4× at Nobile Rim 2 on a wide
  screen).
- **Level view:** the camera never tilts. Looking up or down slides the
  image like an architectural shift lens, so the horizon stays a straight
  line in every direction. The default view is at most 90° wide.
- **Lighting** (all display only; it never feeds a number):
  - One light along the Sun direction casts the shadows on the near
    terrain. The rings cast no shadows, so this light is switched off when
    the physics mask (5–150 km bands) says a distant ridge hides the Sun.
  - **Earthshine:** a pale blue light along Earth's direction. Its strength
    follows Earth's lit fraction (its phase) and fades out when the physics
    says Earth is below the horizon. Earthshine is real; its brightness here
    is scaled for display, not measured.
  - **Bounce light:** extra soft light while the surrounding ridges are
    sunlit but the Sun is hidden from the viewer, as light reflected off
    sunlit slopes does at the poles. Scaled for display.
  - **Readability fill:** a faint, cool light from above so shapes never
    vanish at night. It is not a physical light (starlight is negligible) and
    stays well below sunlight, so lit and dark remain obvious.
- **Ridge shading:** the skyline rings are lit per direction: ridges facing
  the Sun are bright, ridges toward the Sun are backlit and darker. They
  count as sunlit whenever the Sun is above the flat horizon, and never
  darker than the viewer's own physics state allows. When the Sun is up to
  3° below a ridge, that ridge's edge glows gold around the Sun's direction:
  a pointer to where the Sun is hiding.
- **Ground:** smooth shading, a fine regolith texture and gentle
  large-scale brightness mottling (made up, for depth cues). The lander
  stands on the drawn triangles, with a soft contact shadow.
- **Compass and markers:** an HTML compass strip along the top shows
  directions and the Sun and Earth, with arrows when they are off-screen.
  Rings pinned to the Sun and Earth make the true-size disks easy to find;
  they turn dashed with "behind terrain" when the physics says hidden.
- **Sun and Earth** are drawn at their true angular size (Earth about 3.6×
  wider than the Sun). Earth's lit fraction is the true one,
  `(1 − cos θ)/2` with θ the Sun–Earth angle seen from the site.
- **Known limitation:** at k > 1 the disks stay round while their positions
  are stretched, so how much of a half-hidden Sun you *see* is approximate.
  It is exact in "True scale" mode, and the numbers never depend on it.

## Visibility, sunlit fraction and flux
Code: `python/lunar/metrics.py`, ported line for line to `web/src/physics/`
(`visibility.ts`, `metrics.ts`, `events.ts`). The browser recomputes
everything from the shared Sun/Earth vectors and the horizon mask; a shared
test fixture checks both give the same numbers (see VALIDATION.md §5).
- **Horizon at any azimuth:** linear interpolation between the 360 mask
  values (1° apart), wrapping from 359° to 0°.
- **Sunlit fraction:** the Sun is a disk about 0.53° wide (angular radius
  `asin(R_sun / d)`, R_sun = 695,700 km). We test 9 points of the disk, its
  center and 8 points 45° apart on a ring at `r/√2` (r = angular radius),
  and count how many are above the horizon at their own azimuth: 0 = dark,
  1/9 … 8/9 = partly behind a ridge, 1 = fully lit. A sideways offset of x
  degrees on the sky is x / cos(elevation) degrees of azimuth.
  `TODO(astronomer)`: review the ring radius (a numerical choice; `r/√2`
  splits the disk into two equal areas).
- **Lit** means at least half of those points are up (fraction ≥ 0.5). For a
  locally flat horizon this is the same as "the Sun's center is above it".
- **Earth visible** means Earth's center is above the horizon. The margin
  (degrees above or below) is kept, so the UI can show "partly visible"
  (Earth is about 1.9° wide).
- **Flux:** `1361 W/m² / r_AU² × sunlit fraction × panel factor`, with
  panel factor 1 for a Sun-tracking panel, `cos(el)` for a vertical panel
  facing the Sun and `sin(el)` (0 if negative) for a panel lying flat. At the
  pole the Sun is within a few degrees of the horizon, so a flat panel gets
  almost nothing: at Nobile Rim 2 in 2027, 33 W/m² on average against
  446 W/m² for a vertical one. `TODO(astronomer)`: cite 1361 W/m².
- **Between hourly samples** (smooth playback, countdowns): the Sun and Earth
  directions are interpolated linearly and re-normalized, and the Sun
  distance linearly.
- **Sunrise, sunset, Earthrise, Earthset:** starting just after the current
  time, find the first hourly sample whose state (lit / Earth visible)
  differs, then bisect inside that hour on the interpolated directions until
  the time is known to well under a second. The same rule decides "lit now",
  so jumping to a sunrise always lands on a lit moment. A rise and set
  that both happen inside one hour are not detected.
- **Window statistics** (the visible 30 days, and all of 2027), over hourly
  samples: % of hours lit, mean sunlit fraction, % of hours with Earth
  visible, % with both, the longest dark stretch and the longest Earth
  blackout (counted only inside the window), and mean flux per panel type.
  The full-year numbers for the site center are also written into the site
  file by Python (`precomputed.center.year`), from the same rounded numbers
  the browser reads.

## Battery and signal icons (display rules, not physics)
These are metaphors for the public; the real numbers are shown beside them.
- **Battery:** full and charging whenever the Sun is lit (recharge is
  assumed instant), then drains evenly over a **72 h** battery (the spec's
  default endurance) while dark; empty if the night lasts longer. The data
  starts on 2027-01-01 00:00; if the site is dark then, the battery is
  assumed full at that moment, and the panel says so.
- **Signal bars:** 0 ("No service") when Earth's center is behind terrain;
  1 when its center is up but part of the disk is still hidden (less than one
  Earth radius of clearance); 2 up to 2°, 3 up to 4°, 4 above that. The bar
  thresholds are a design choice; the clearance in degrees is shown under it.

## Site Score
TODO: formula and weights. The weights are a design choice, not physics.
