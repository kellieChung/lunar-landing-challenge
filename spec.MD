# H.A.L.O.sim: Lunar Landing Site Navigator, design

NASA Space Apps 2026. Team **T^2 = Ka^3**: a builder (frontend) and an astronomer (physics, validation). This document describes what the app does and how it is put together. The physics is written up in `docs/METHODS.md`, how it was checked in `docs/VALIDATION.md`, and the Moon Base game in `game.MD`.

**Privacy rule:** both team members are under 18. No team member's name, photo, voice or email goes into the app, the project page or demo assets. The team is credited by team name only.

## The product

A browser tool where anyone can "stand" at a candidate landing site near the Moon's south pole and look around in 3D, to see when they would have solar power and when they could talk to Earth. Near the pole the Sun doesn't rise and set the usual way: it circles the horizon about once every 29.5 days, staying within a few degrees of it, and Earth hangs almost still, rocking a few degrees because of libration. So **the surrounding mountains, not the time of day, decide whether a site has power or contact with Earth.** The app makes that physics explorable in 30 seconds for students, educators and the public, with the real numbers alongside for anyone who wants them.

Hook question shown in the UI: **"Can my lander survive here?"**

Two modes share the same physics:
- **Explore** (the Navigator): look around, scrub through 2027, compare spots and mast heights.
- **Moon Base** (the game, ages ~9–13): make rocket fuel from Moon ice to fly home, choosing spots by reading the real sky (`game.MD`).

## Architecture

```
python/ (offline precompute)                   web/ (static site, Vite + TypeScript + three.js)
  LOLA maps ──► horizon masks, per grid point ─┐
  SPICE     ──► Sun/Earth vectors, 2027 hourly ┼─► public/data/*.json, *.bin ──► 3D view, 2D strip,
  metrics (also recomputed in the browser) ◄───┘                                  time bar, stats, game
```

- **Everything is precomputed in Python into static files.** There is no backend server; the site is deployed as static files on Vercel.
- The browser does the cheap part: for the current time and grid point, it compares the Sun's and Earth's elevation with the horizon mask. `web/src/physics/` is a line-for-line port of `python/lunar/metrics.py`, and a shared fixture checks that both give the same numbers.
- **Rendering never decides visibility.** Lit, Earth-visible and every metric come from the horizon-mask math. The 3D scene only shows it; if the picture and the numbers disagree, the numbers win.

```
python/
  lunar/ephemeris.py      Sun/Earth vectors in a site frame (SpiceyPy)
  lunar/dem.py            LOLA map stack (5 m tiles, 10 m crops, 20 m, 240 m)
  lunar/horizon.py        horizon mask by ray walk
  lunar/grid.py           the 11 × 11 grid of observer points
  lunar/terrain.py        heightmaps for the 3D view
  lunar/metrics.py        lit / Earth visible, windows, flux
  lunar/sites.py          the curated site list
  lunar/validation.py     helpers for the validation tables
  scripts/                fetch data, build sites, build the globe model, validation tables
  tests/
web/
  public/data/            generated site files (committed)
  public/models/          the globe's Moon and NASA's 3D models
  src/physics/            TS port of visibility and metrics
  src/globe/              the site picker's 3D Moon
  src/panorama3d/         first-person 3D view
  src/panorama/           2D horizon strip
  src/ui/                 time bar, stats panel, spot map, mast control, tour
  src/game/               Moon Base
docs/
  METHODS.md, VALIDATION.md
```

## Data sources

Downloaded into `python/data/` (gitignored) by `python/scripts/fetch_data.sh`:
- **SPICE kernels** (NAIF generic kernels): planetary ephemeris `de440s.bsp`, lunar orientation `moon_pa_de440_200625.bpc` with frame kernel `moon_de440_250416.tf`, leap seconds `naif0012.tls`, generic constants `pck00011.tpc`.
- **LOLA elevation maps** (NASA GSFC PGDA; Barker et al. 2023): 5 m/pixel site tiles where available, 10 m/pixel crops of `LDEM_83S_10MPP_ADJ` for sites without one, the 20 m/pixel 80–90°S map, and the 240 m/pixel 60–90°S map for the far field. Heights are relative to a 1737.4 km sphere.
- **JPL Horizons**: used only for validation, never at runtime.
- **The globe** (`web/public/models/moon.glb`): NASA's 8k Moon model with the 240 m LOLA south-pole map blended in, built by `python/scripts/build_optimized_moon.py`.
- **3D models** (lander, rovers, base parts): NASA's official 3D resources, credited in `web/public/models/nasa/CREDITS.md`.

## Physics pipeline (summary)

Full details and equations: `docs/METHODS.md`.

1. **Site frame:** one fixed east/north/up frame at each site center. Every grid point measures azimuth from the same "grid north", so directions line up across the grid.
2. **Ephemeris:** calendar year **2027** (the Artemis III timeframe), 1-hour steps (8,760 samples). Sun and Earth directions from SPICE (`MOON_ME`, light time and stellar aberration), plus the Sun's distance (for flux) and Earth's (for eclipses). Libration comes from the lunar orientation kernel.
3. **Horizon masks:** for each of the 121 grid points (11 × 11, 1 km apart) and each of 360 azimuths, walk outward from 10 m to 250 km over the LOLA map stack and keep the largest exact 3D elevation angle. Masks are computed for a 3 m mast and again at 5, 10, 20 and 30 m.
4. **Visibility and metrics:** the Sun's disk is sampled at 9 points (lit = at least half of it above the horizon); Earth is visible when its center is above the horizon. From those: % sunlit, % Earth visible, % both, the longest dark stretch, the longest Earth blackout, countdowns to the next sunrise / Earthrise, and flux for tracking, vertical and flat panels.

## Data files

`web/public/data/` (shapes in `web/src/data/types.ts`):
- `sites.json`: the site list for the globe, with every grid point's full-year numbers.
- `<site>.json`: the site, the time axis, the Sun and Earth vectors, the grid (each point's offset, up tilt, ground height, `mask_deg` and the three distance-band masks for the 3D rings), the mast file index, the terrain headers and the precomputed year numbers for the site center.
- `<site>_mast<h>.json`: every grid point's horizon at a raised mast height (loaded when that height is first picked).
- `<site>_terrain.bin`: 20 × 20 km at 100 m around the site center; `<site>_detail.bin`: 13 × 13 km at 10 m. Rendering only.

## Curated sites

Nine south-pole sites matching NASA's Artemis III candidate landing regions. Latitude negative = south; longitude in degrees east, −180 to 180. Sources and notes: `docs/VALIDATION.md`, "Site coordinates and sources".

| id | name | lat (°) | lon (°E) |
| --- | --- | --- | --- |
| cabeus-b-peak | Peak near Cabeus B | -83.661 | -69.014 |
| haworth | Haworth | -86.80402 | -21.66710 |
| malapert-massif | Malapert Massif | -85.995 | -0.236 |
| mons-mouton-plateau | Mons Mouton Plateau | -84.232 | 29.926 |
| mons-mouton | Mons Mouton | -85.423 | 31.586 |
| nobile-rim-1 | Nobile Rim 1 | -85.54419 | 37.62660 |
| nobile-rim-2 | Nobile Rim 2 | -84.20156 | 60.69989 |
| de-gerlache-rim-2 | de Gerlache Rim 2 | -88.51566 | -61.167319444 |
| slater-plain | Slater Plain | -87.149 | 126.134 |

## Frontend

Routes are query parameters on one page: `/` is the picker (`?focus=<id>` selects a site), `?site=<id>` opens a site (`&pt=i,j`, `&hour=N`, `&view=2d`, `&mast=N`, `&mode=game`).

1. **Site picker:** a 3D Moon with the south pole toward the camera and a pin per site, plus an HTML list of every site (the keyboard and no-WebGL path). Each site card links to Explore and, where there is an ice run, to Moon Base. A first-visit tip suggests exploring first, then playing.
2. **Explore view** (first-person 3D, three.js):
   - The camera stands at the mast height. Drag to look around, scroll or pinch to zoom; no walking.
   - **Skyline rings** built from the three distance-band masks, whose top edge is exactly the physics horizon.
   - **Near terrain:** the 10 × 10 km heightmap around the chosen point, with a 3 × 3 km 10 m detail patch, lit by the Sun with real-time shadows.
   - **Sky:** stars, the Sun and Earth at true angular size (Earth with its real phase), Earthshine, and the faint paths of the Sun and Earth.
   - **Vertical exaggeration** chosen per site (up to 5×) and a **True scale** toggle.
   - A compass strip with Sun and Earth markers, NASA's lunar module as the lander, and a 2D horizon strip as an alternative view.
   - A 4-step first-visit tour (again from the **Tour** button).
3. **Time bar:** the year and the visible 30 days, coloured by state (gold = Sun, blue = Earth, green = both); play at 1 day/s, 1.5 days/s or 1 week/s; **Next sunrise** and **Next Earthrise** jumps.
4. **Stats panel:** a battery icon (power) and signal bars (Earth contact) that update with time, countdowns to the next sunrise and Earthrise, the **mast height** control (Lander 3 m, Tower 10 m, VSAT-XL 30 m; stops at 3, 5, 10, 20 and 30 m), 30-day and year statistics, solar panel power by panel type, and the **spot map**: the 11 × 11 grid coloured by sunlight, where clicking a cell moves you there.
5. **Moon Base:** the game runs on top of the same view (`game.MD`).

**Visual style:** a mission-control HUD on the globe, and the Sprout Lands pixel UI (by Cup Nooble, recoloured to space grey) on panels and in the game. Colour is never the only signal; every state also has an icon or a word.

## Validation

Results and tables: `docs/VALIDATION.md`.
1. **Horizon tests** on synthetic terrain (smooth sphere, a single cone mountain) and a convergence check of the ray walk.
2. **Ephemeris against JPL Horizons** for several sites and times.
3. **Sanity checks:** the Sun stays within (distance from the pole + ~1.5°) of the horizon; Earth stays near the zenith at the equator.
4. **Long-term averages and eclipses:** 2027 against 2026–2044, and the Sun eclipsed by Earth.
5. **Python ↔ TypeScript parity:** a shared fixture tested in both languages.
6. **Limits:** map resolution, the 10 m–250 km ray walk, one year of data, hourly sampling and the display-only battery and signal rules.
