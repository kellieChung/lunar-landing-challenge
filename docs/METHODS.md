# Methods

Physics write-up for the project page.

## Site frame
Code: `site_frame` in `python/lunar/ephemeris.py`, `point_axes` in
`python/lunar/grid.py` (ported to `web/src/physics/grid.ts`).
- Each site has one fixed local frame at its center, built in the Moon's
  body-fixed `MOON_ME` frame (the same frame as the LOLA maps):
  - **up** = unit vector from the Moon's center through the site
    (planetocentric latitude and longitude on the 1737.4 km sphere);
  - **east** = the `MOON_ME` +Z axis (the Moon's mean rotation axis) × up,
    normalized;
  - **north** = up × east.
- **Azimuth** is measured clockwise from this "grid north" toward east;
  **elevation** is the angle above the plane perpendicular to up.
- **Why one frame for the whole grid:** near the pole, true north turns
  quickly as you move sideways (by `tan(|lat|) / R` radians per km: about
  0.38° per km at 85° S, 1.3° per km at 88.5° S), so per-point azimuths would not line up. With one frame,
  "azimuth 90°" points the same way at every grid spot, and the Sun/Earth
  vectors (computed once at the center) can be shared by all of them.
- **Each grid spot's own up** is tilted from the center's by about 0.033°
  per km. Its east is the site's east with the small up part removed; its
  north is up × east. Sun and Earth directions are rotated into these axes
  before any elevation is compared with that spot's horizon (exact rotation,
  so unit vectors stay unit vectors).
- The frame is undefined exactly at a pole (east has no direction), so the
  code refuses a site at ±90°; all nine sites lie between 83.6° S and 88.6° S.

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
  2023, *Planetary Science Journal* 4, 183, doi:10.3847/PSJ/acf3e1). Maps are
  stacked finest first: LOLA 5 m/pixel site tiles (about 20 × 20 km each,
  `*_5mpp_surf.tif`, used when one comes within 20 km of the site), or for
  sites with no 5 m tile (Peak near Cabeus B, Slater Plain) a 30 × 30 km window
  of the 10 m/pixel 83–90°S map (`LDEM_83S_10MPP_ADJ`, cut by
  `scripts/fetch_10mpp_crops.py` as `*_10mpp_crop.tif`), then the
  20 m/pixel map (80–90°S), then the 240 m/pixel map (60–90°S) where neither
  has data. Within 200 m of a site tile's edge its heights blend linearly into
  the 20 m map, so there is no step at the seam. Heights are relative to a 1737.4 km sphere, in the
  MOON_ME frame (DE421), which matches the `MOON_ME` frame we use for the Sun
  and Earth.
- **Method:** from the observer (ground height + 3 m mast), for each of 360
  azimuths (1° steps, measured from the site's grid north), we walk outward
  along the surface from 10 m to 250 km: every 5 m up to 100 m, every 10 m up
  to 2 km (fine enough for the 5 m tiles), every 50 m up to 5 km, then in
  steps of 1% of the distance. The walk starts 10 m out because with a 3 m
  mast even a 3 m rise 50 m away is a 3° obstacle; it goes to 250 km because
  from a 6 km high site the horizon is over 145 km away and peaks beyond it
  still show (201 km at Mons Mouton). The 20 m map is read to 160 km and the
  240 m map from there to 250 km. At each step we look up the terrain height and compute
  the exact 3D elevation angle

  `elevation = asin( dot(P − O, up_O) / |P − O| )`

  where O is the observer and P the terrain point (vectors from the Moon's
  center) and `up_O = O/|O|`. The horizon at that azimuth is the largest
  angle found. This includes the Moon's curvature automatically. (For intuition:
  this is about `atan(Δh/d) − d/(2R)`.)
- **Ground height** at the site comes from the same map and is also used for
  the observer position in the Sun/Earth calculation.

## Grid points around a site
- Each site has an **11 × 11 grid of observer points, 1 km apart** (10 × 10 km),
  so you can compare nearby landing spots. Point (i, j) is i km east and j km
  north of the site center, measured on the flat plane touching the Moon at
  the center and dropped straight down to the surface. The near-terrain
  heightmap uses the same mapping, so the two always line up.
- **One frame for azimuth:** all points measure azimuth from the site center's
  grid north (see Site frame), so "azimuth 90°" means the same direction
  everywhere in the grid.
- **Each point's own "up":** the surface curves, so a point 1 km away is
  tilted about 0.033° from the center's up (5 km: 0.165°). Each point stores
  that tilt. Its horizon mask is computed with elevation angles from its own
  up. Before comparing them, the Sun and Earth directions are rotated into the
  point's own east/north/up, both in Python and in the browser.
- **Same Sun/Earth for every point:** the Sun and Earth directions are computed
  once at the site center. Moving 7 km changes the direction to Earth by at
  most 7 / 384,400 rad ≈ 0.001°, and to the Sun by far less, so this is
  negligible.
- The full-year numbers for every point are precomputed in Python and shown
  as colored dots when you zoom onto a site on the globe. The browser
  recomputes them for the point you stand on, and both agree to 1e-6.

## 3D view (rendering only)
The 3D view only *shows* the physics. Whether the Sun is lit or Earth is
visible always comes from the horizon mask (`src/physics/visibility.ts`); if
the picture and the numbers ever disagree, the numbers are right.
- **Layered skyline rings:** the same ray walk that builds the horizon mask
  also keeps the highest angle within three distance bands (0–5, 5–30 and
  30–250 km). Each band is drawn as a curtain around the viewer, far to near,
  so the top edge you see is the maximum of the three, which is exactly the
  physics horizon.
- **Near terrain:** a 10 × 10 km heightmap (101 × 101 points, 100 m apart)
  around the observer from the same LOLA maps. Python exports 20 × 20 km
  around the site center; the browser moves the origin to the chosen grid
  point, re-levels it for that point's own up (`z' = z − z(p) + r'·p / R`,
  see `recenter` in `heightmap.ts`) and keeps the 10 × 10 km around it. Heights are measured along the
  site's "up" direction, so they include the Moon's curvature (flat ground
  5 km away sits about 7 m lower). Any point drawn above the physics horizon
  is lowered onto it (a handful of points, because the mesh is coarser than
  the ray walk), so the mesh can never hide a Sun the physics says is up.
- **Detail patch:** the 3 × 3 km nearest the observer is drawn from a second
  heightmap at 10 m spacing (Python exports 13 × 13 km covering the whole
  grid, as int16 in 0.1 m steps, about 3.4 MB). The 100 m cells under it are
  left out; the patch's edge sits exactly on the 100 m triangles and blends
  into them over 200 m, so there are no cracks or steps. Only about 0.1% of
  its points need lowering onto the physics horizon. Shadows use one 4096²
  shadow map (2048² on GPUs that can't) and are redrawn only when the Sun or
  the stretch changes, not while you look around.
- **Vertical exaggeration:** every height is stretched by the same factor k
  around the viewer's eye. An elevation angle *el* is then shown at
  `atan(k · tan el)`. This keeps the order of things at every azimuth (a Sun
  above a ridge is drawn above it), keeps the mesh, rings and shadows
  consistent with each other, and k = 1 is exact true scale. k is chosen per
  site: the largest value up to 5× that fits the whole year's horizon, Sun
  and Earth in 80% of the view height (about 2.6× at Haworth on a wide
  screen). The 2D strip uses the same 5× cap.
- **Level view:** the camera never tilts. Looking up or down slides the
  image like an architectural shift lens, so the horizon stays a straight
  line in every direction. The default view is at most 90° wide.
- **Lighting** (all display only; it never feeds a number):
  - One light along the Sun direction casts the shadows on the near
    terrain. The rings cast no shadows, so this light is switched off when
    the physics mask (5–250 km bands) says a distant ridge hides the Sun.
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
- **Stars and Earth's face are artistic:** the star positions are random
  (not a real star map) and Earth's continents and clouds are generated
  patterns that do not turn. Earth's position, size and phase are real.
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
  degrees on the sky is x / cos(elevation) degrees of azimuth. The ring
  radius is a numerical choice: `r/√2` splits the disk into two equal areas.
- **Lit** means at least half of those points are up (fraction ≥ 0.5). For a
  locally flat horizon this is the same as "the Sun's center is above it".
- **Earth visible** means Earth's center is above the horizon. The margin
  (degrees above or below) is kept, so the UI can show "partly visible"
  (Earth is about 1.9° wide).
- **Eclipses:** a few times a year Earth passes in front of the Sun (what
  Earth sees as a lunar eclipse). The **eclipse share** is the part of the
  Sun's disk not covered by Earth's disk, from the overlap of two circles
  (Sun radius `asin(R_sun/d)`, Earth radius `asin(6371 km / d_Earth)`, centers
  the Sun–Earth angle apart). It is 1 almost always; in 2027 it only drops
  once, to 0.55 on 17 August for about 3 hours. It scales the flux only:
  "lit" stays a terrain test, so a total eclipse (none in 2027) would show as
  lit with zero power. Earth's atmosphere, which bends a little red light
  into the shadow, is ignored. The time bar marks eclipses with a white notch.
- **Flux:** `1361 W/m² / r_AU² × sunlit fraction × eclipse share × panel factor`, with
  panel factor 1 for a Sun-tracking panel, `cos(el)` for a vertical panel
  facing the Sun and `sin(el)` (0 if negative) for a panel lying flat. At the
  pole the Sun is within a few degrees of the horizon, so a flat panel gets
  almost nothing: at Nobile Rim 2 in 2027, 33 W/m² on average against
  436 W/m² for a vertical one. 1361 W/m² is the IAU 2015 nominal total
  solar irradiance.
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
- **One year is not the long-term average.** The Moon's orbit takes 18.6
  years to return to the same tilt, so yearly numbers drift: over 2026–2044
  a site's % sunlit moves by about 2–4 points and its Earth visibility by up
  to 9 (VALIDATION.md §4). Published illumination maps are multi-year
  averages and usually count *any* visible part of the Sun as lit, which is
  1–3 points higher than our "at least half the disk" rule.

## Raise the mast
A slider and three presets in the side panel (Lander 3 m, Tower 10 m,
VSAT-XL 30 m; stops at 3, 5, 10, 20 and 30 m) raise the solar panel and
antenna together. Each height has its own horizon mask from the same ray
walk, so the lit / Earth-visible rules and every number on screen are
recomputed for it; the 3D camera rises to the same height. Every one of the
121 grid spots has its own horizon at every height (one file per height,
`<site>_mast<h>.json`, about 1 MB, downloaded the first time that height is
picked), so the height stays as you move between spots, and the spot map
recolors to show the year at that height. Heights below 3 m are never
offered. The panel shows the spot's year numbers at that height against
3 m (VALIDATION.md §1c). The Moon Base game always uses 3 m.

## Battery and signal icons (display rules, not physics)
These are metaphors for the public; the real numbers are shown beside them.
- **Battery:** full and charging whenever the Sun is lit (recharge is
  assumed instant), then drains evenly over a **192 h** (8-day) battery (the team's
  default endurance) while dark; empty if the night lasts longer. The data
  starts on 2027-01-01 00:00; if the site is dark then, the battery is
  assumed full at that moment, and the panel says so.
- **Signal bars:** 0 ("No service") when Earth's center is behind terrain;
  1 when its center is up but part of the disk is still hidden (less than one
  Earth radius of clearance); 2 up to 2°, 3 up to 4°, 4 above that. The bar
  thresholds are a design choice; the clearance in degrees is shown under it.

## Moon Base mode (game)
Code: `web/src/game/`. The game reuses the Navigator's physics and never
computes its own: every number about the Moon comes from `src/physics/` or
`sites.json`. All other numbers sit in `web/src/game/constants.ts` with their
source. In the game each number carries a tag: **REAL**, **ESTIMATE** or
**HYPOTHETICAL**.

| What | How | Tag |
| --- | --- | --- |
| Solar power | 10 kW tower × sunlit fraction × (1 AU / r)², Sun-tracking, at the tower's grid spot, every hour of 2027 (`fluxWm2`) | REAL sunlight, ESTIMATE tower size (NASA VSAT class) |
| Earth contact | rovers are driven from Earth by radio (straight lines), so they drive and dig only while Earth's center is above the base's horizon (`siteSeries().earth`); caught out when Earth sets, they park (0.05 kW heaters) until it rises. A rover starts a trip only if it can finish before Earth sets, as rover teams plan drives around communication windows. Future lunar relay satellites would relax this. | REAL visibility; simplified operations |
| Where ice can be | cold-trap tiers by the floor's mean sunlit share over 2027 (exact hourly series, 3 m mast): **rich** = no part of the Sun's disk in any hour; **sunlit** = above 0 up to 15%; **none** above. A one-year test of our own, **not** the official multi-year PSR maps (e.g. Mazarico et al. 2011); the 15% cut-off is a game rule | REAL sunlight, game-rule tiers |
| How much ice | a fixed value per spot spread over 5.6 ± 2.9 wt% (LCROSS, Colaprete et al. 2010), times the share that survives the Sun: all of it on a floor that never sees the Sun, shrinking linearly to a quarter at the 15% cut-off | HYPOTHETICAL |
| Rover | 0.72 km/h and 15° max slope (NASA VIPER); routes between 8-neighbour grid spots, slope from the LOLA ground heights 1–1.4 km apart; 30 kg per trip (a NASA RASSOR study assumed 20 kg; IPEx is itself a ~30 kg-class robot) | ESTIMATE speed/slope, HYPOTHETICAL payload |
| Rover battery | 8 kWh; driving and digging use 0.3 kW; a rover leaves only with enough charge for the round trip plus 0.5 kWh, so spots beyond one charge are out of range | HYPOTHETICAL |
| Moon dirt (regolith) | the dry regolith left after baking out the ice is the game's building material | REAL mass balance |
| Landing pad | packed regolith pad with a berm, so Earth can land hardware near the base without sandblasting it (Metzger et al.; NASA landing / launch pad concepts). Each pad brings one rover, solar tower or 48 kWh battery pack; 150, 250, 350 … kg | ESTIMATE idea, HYPOTHETICAL costs |
| Dirt cover | base hardware under heat-holding regolith ("thermal wadi", NASA NIAC): keep-alive power × 0.5; 250 kg | ESTIMATE idea, HYPOTHETICAL numbers |
| Packed roads | graded, compacted regolith tracks: rover speed × 1.5; 300 kg | ESTIMATE idea, HYPOTHETICAL numbers |
| Dirt-lined oven | the ice oven wrapped in regolith insulation: baking energy × 0.75; 350 kg | ESTIMATE idea, HYPOTHETICAL numbers |
| Baking ice out | 0.04 kWh per kg regolith + 0.78 kWh per kg ice (sublimation ≈ 2.8 MJ/kg) | ESTIMATE |
| Electrolysis | 1 kg water → 0.112 kg H₂ + 0.888 kg O₂; 53 kWh per kg H₂ (theory ≥ 39.4) | REAL masses, ESTIMATE energy |
| Fuel target | the fuel to fly home after the lander's tank leaks: rocket equation, 150 kg dry (a small vehicle of the size of robotic sample-return stages), Δv 2.8 km/s, Isp 450 s, O/F 6 → 133 kg (19 kg H₂ + 114 kg O₂) | REAL formula, ESTIMATE inputs, HYPOTHETICAL vehicle |
| Battery | 0.25 kW keep-alive for the Navigator's 192 h endurance = 48 kWh; empty → the base sleeps until 10% charged | HYPOTHETICAL design |

**How it plays** (full design: `game.MD`). A run is one seeded draw: a
site, a start at the midnight before a sunrise or sunset at the site center, and
three landing spots chosen so none beats another on all of % sunlit, % Earth,
longest night and distance to ice. The player compares them by *looking* (3D
view, year timeline, Sun / Earth *windows* from `game/windows.ts`), then
three craters, and later where a solar tower stands. After each choice an
autopilot (`game/autopilot.ts`) replays the run on the real sky for every
option, and the reveal shows the REAL metrics plus each option's projected
launch day (ESTIMATE); Sky Sense scores the pick by that projection's rank,
with outcomes within 2 days counted as ties. The ridge flash turns the
camera to the Sun at the middle of the spot's longest dark stretch and says
whether a ridge or the horizon hid it (`game/why.ts`, from the mask and the
SPICE vector). Time runs at 1 or 3 days per second, slows near sunsets and
Earthsets, and stops for every choice. The tank must fill within 3 Sun
circuits (2,124 h, 89 days) of landing. Launching completes the site, and
each completed site unlocks the next one.

Nothing physical is scaled for game balance; the levers are design choices
(the vehicle size, the building costs, the tier cut-off). A site hosts runs
only if some start can launch in time (`par.test.ts`, which also orders the
unlocks): 8 of 9 do. Malapert Massif has no floor dark enough nearby.
A strategy sweep (`balance.test.ts`) checks that no single delivery order
is best everywhere: rovers-first launches first at most sites, and a mixed
order (rovers, towers and batteries) at the rest. **Not modelled:** keeping
hydrogen liquid (cryogenics, boil-off), machine temperatures, dust, masts
taller than 3 m, and slopes between the 1 km grid spots. Rare-earth elements
are left out on purpose: they are concentrated in the near side's
Procellarum KREEP Terrane, not at the south pole.
