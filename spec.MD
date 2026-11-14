# Lunar Landing Site Navigator — build brief

NASA Space Apps 2026 (Universal Event, Nov 14–15). Two-person team: one builder (frontend, glue), one astronomer (physics, validation). This file is the source of truth for what we are building and how. Read it fully before writing code.

## How to work (instructions for Claude Code)

- Build in the **milestone order** at the bottom. Each milestone must run end to end before starting the next. Commit after each one.
- Prefer simple, readable code over clever code. This is a 48-hour hackathon; the astronomer must be able to read the Python.
- **Never invent physics numbers or site coordinates.** If something is marked `TODO(astronomer)`, leave a clear placeholder and tell me.
- Every physics function gets a small test (see "Validation"). Run only the tests for what you changed; run the full suite before each commit.
- If a choice would change the product (not just the code), stop and ask instead of guessing.
- Keep dependencies minimal. Don't add a framework or service that isn't listed here without asking.
- **Privacy rule:** both team members are under 18. Never put personal names, photos, voices, emails or usernames into the repo, the UI, the README or demo assets. Credit the team by team name only.

## The product in one paragraph

A browser tool where anyone can "stand" at a candidate landing site near the Moon's south pole and look around in 360°, Street View style, to see when they would have solar power and when they could talk to Earth. Near the pole the Sun doesn't rise and set; it circles the horizon once every ~29.5 days while staying within a degree or two of it, and Earth hangs almost still, rocking a few degrees due to libration. So **the surrounding mountains, not the time of day, decide whether a site has power or comms.** We make that physics explorable in 30 seconds for students, educators and the public, with real numbers for planners. We are not trying to out-calculate NASA; we make the same physics accessible.

Hook question shown in the UI: **"Can my lander survive here?"**

## Judging strategy (drives priorities)

Criteria: Influence, Creativity, Validity, Relevance, Presentation (equal weight). Validity is our strength (documented physics, reproduced published values). Creativity is our weak spot: the first-person panorama plus the approachable metaphors below are the answer. Most of the evaluation is the project page and a short captioned screen recording, so screens must look good in a recording.

## Architecture

```
python/ (offline precompute)                 web/ (static site)
  LOLA DEM ──► horizon masks (per grid pt) ─┐
  SPICE    ──► Sun/Earth unit vectors (yr) ─┼─► data/*.json ──► Canvas 2D panorama
                                            │                   time slider, stats,
  metrics (also recomputed in browser) ◄────┘                   site picker
```

- **Everything is precomputed in Python into static files.** No backend server.
- The browser does the cheap part: for the current time and grid point, compare Sun/Earth elevation with the horizon mask.
- Repo layout:

```
python/
  pyproject.toml          # numpy, spiceypy (or skyfield), rasterio, pytest
  lunar/ephemeris.py      # Sun/Earth vectors in a site frame
  lunar/horizon.py        # horizon mask from DEM
  lunar/metrics.py        # windows, % sunlit, longest dark, flux, score
  lunar/sites.py          # curated site list
  scripts/fetch_data.sh   # downloads kernels + DEM tiles (not committed)
  scripts/build_site.py   # writes web/public/data/<site_id>.json
  tests/
web/
  (Vite + TypeScript; React for panels is fine, panorama is a raw <canvas>)
  public/data/            # generated JSON (committed for the demo)
  src/panorama/           # canvas renderer
  src/ui/                 # panels, slider, picker
  src/physics/            # TS port of visibility + metrics (must match Python)
docs/
  METHODS.md              # physics write-up for the project page
  VALIDATION.md           # comparison tables
```

## Data sources

Download into `python/data/` (gitignored). Verify exact file names on the source sites before scripting; the names below are what we expect.

- **SPICE kernels** (NAIF generic kernels):
  - planetary ephemeris `de440.bsp` (or `de440s.bsp`, smaller)
  - lunar orientation binary PCK `moon_pa_de440_*.bpc` and frame kernel `moon_de440_*.tf`
  - leap seconds `naif0012.tls`, generic PCK `pck00011.tpc`
- **LOLA elevation** (PDS Geosciences Node / LOLA data products):
  - a south-polar stereographic DEM for 80°S–90°S at ~20–60 m/pixel (near field)
  - a coarser polar or global DEM (~120–240 m/pixel) for the far field out to 150 km
  - heights are relative to a 1737.4 km reference sphere
- **JPL Horizons** API: used only for validation, not at runtime.

## Physics pipeline (Python)

### 1. Site frame

For each curated site, define a **fixed local tangent frame at the site center**: `up` = unit vector from Moon center to site, `east` and `north` from the lunar body-fixed frame (MOON_ME). All grid points around that site use **this same frame for azimuth** ("grid north").

Why: near the pole, local north swings a lot over a few km, so per-point azimuths wouldn't line up. Using one frame keeps directions consistent, and the Sun/Earth direction vectors are then the same for every point in the grid (parallax over a few km is negligible).

### 2. Ephemeris → Sun and Earth vectors

- **App data:** calendar year **2027**, from 2027-01-01T00:00 to 2028-01-01T00:00 UTC, **1-hour step** (8,760 samples). 2027 is in the Artemis III timeframe, and a full year captures the seasonal and libration cycles.
- **Why hourly is enough:** near the pole the Sun moves along the horizon about 0.5° per hour, roughly one Sun diameter, and Earth moves even more slowly. Rise and set times from hourly samples are good to within about ±30 min.
- **Countdowns:** for sunrise, sunset, Earthrise and Earthset, interpolate linearly between the two bracketing hourly samples (vectors, then elevation minus mask) to find the crossing to the minute. Do this in both Python and TS.
- **Validation-only run:** published illumination percentages are usually long-term averages. For the comparison table only, also run the site centers over a longer span (e.g. 2026–2035) at a **6-hour step**. Don't ship this to the browser.
- With SpiceyPy: `spkpos` target `SUN` and `EARTH`, observer `MOON`, frame `MOON_ME`, aberration `LT+S`. Subtract the site position (body-fixed, radius 1737.4 km + DEM height + mast height) to get topocentric vectors, then rotate into the site frame (east, north, up).
- Output per sample: **unit vectors** for Sun and Earth in the site frame, plus Sun distance (AU) for flux.
- Libration is handled automatically by the lunar orientation kernel. Mention this in METHODS.md; the challenge asks about it.
- No atmosphere means no refraction: positions are purely geometric.

### 3. Horizon mask

For each grid point (default **11 × 11 points at 1 km spacing** around the site center) and each azimuth (**360 directions, 1° step**):

- Walk outward along the azimuth from 0.1 km to **150 km**. Use fine steps near the point (e.g. 50 m up to 5 km), then grow the step with distance (e.g. 1% of distance). Sample the near-field DEM within its coverage, the far-field DEM beyond.
- Use the **exact 3D form**, not the small-angle formula. With `O` the observer position vector (from Moon center, including mast height) and `P` a terrain point vector:

  `elevation_angle = asin( dot(P − O, up_O) / |P − O| )`

  where `up_O = O / |O|`. The horizon at that azimuth is the **max** over all samples. This automatically includes lunar curvature. (The small-angle version `atan((z−z0)/d) − d/(2R)` is fine for intuition and docs.)
- Express azimuth in the site frame (step 1). For off-center grid points, also store each point's own `up` tilt relative to the site frame, so elevations can be corrected exactly (the correction is ~0.033° per km).
- **Observer height** is two separate settings:
  - **solar panel height** (top of the array): used for sunlight, default **3 m**
  - **antenna height**: used for Earth visibility, default **3 m**

  These are typical of a small CLPS-class lander (a few metres tall). Planned south-pole power towers from NASA's Vertical Solar Array Technology (VSAT) effort are much taller. For example, Astrobotic's VSAT-XL raises its arrays over 10 m above the terrain on a tower over 30 m tall ([Astrobotic](https://www.astrobotic.com/astrobotic-developing-xl-solar-array-tech-for-lunar-power-infrastructure/)). **Core build: fixed 3 m** for everything (3 m is also the minimum height anywhere in the app). **Optional (stretch), only after milestone 8:** for the **site center only**, precompute extra masks at **5, 10, 20 and 30 m** for a "Raise the mast" control with presets **Small lander (3 m)**, **Power tower (10 m)**, **VSAT-XL-class (30 m)**. Never offer heights below 3 m. `TODO(astronomer)`: confirm the small-lander default from a real lander's specs and cite it.
- Vectorize with numpy: shape `(360, n_samples)` per point. Target < 2 s per point.

### 4. Visibility and metrics

At each time step, for a given grid point:

- `sun_el`, `sun_az` and `earth_el`, `earth_az` from the vectors (elevation measured against that point's own `up`).
- `mask(az)`: linear interpolation in the 360-value mask (wrap around at 360°).
- **Sunlit fraction (partial disk):** the Sun is a disk ~0.53° wide. Sample it with ~9 points (center + ring) and return the fraction of points whose elevation exceeds the mask at their azimuth. 0 = dark, 1 = fully lit.
- **Earth visible:** Earth center elevation > mask at its azimuth (Earth is ~1.9° wide; store the margin so the UI can show "partially visible").
- **Flux (W/m²):** `1361 / r_AU² × sunlit_fraction × panel_factor`, where `panel_factor` = 1 for a Sun-tracking panel, `sin(sun_el)` for a horizontal panel, `cos(sun_el)` for a vertical panel facing the Sun. Showing horizontal vs vertical is a key teaching point: at the pole, horizontal panels get almost nothing.
- Metrics over a window (30 days by default, also the full year):
  - % time sunlit (fraction ≥ 0.5 counts as lit; also report mean fraction)
  - % time Earth visible
  - % time both
  - longest continuous dark stretch (hours)
  - longest comms blackout (hours)
  - time until next sunset, sunrise, Earthset, Earthrise from a given moment
  - mean flux for each panel type

### 5. Site Score (approachability, must stay transparent)

A 0–100 score and letter grade, from a documented formula with weights in one config file:

- 40% sunlit fraction, 25% Earth-visible fraction, 25% longest dark stretch vs. battery endurance (default 72 h; full marks if shorter, zero at 3× longer), 10% longest comms blackout.
- Grades: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, else F.
- Also output the **"credit report" factors**: the two biggest positive and negative contributors, each as a short sentence with its number (e.g. "Hurting: 4.2-day night in April, longer than your 3-day battery").

The weights are a design choice, not physics. Say so in METHODS.md.

### 6. Output JSON (one file per site)

`web/public/data/<site_id>.json`:

```jsonc
{
  "site": { "id": "shackleton-ridge", "name": "...", "lat": 0, "lon": 0, "kind": "south-pole|equator|far-side", "blurb": "one line on why it matters" },
  "frame": { "description": "site-center ENU, azimuth from grid north" },
  "time": { "start": "2027-01-01T00:00:00Z", "step_hours": 1, "count": 8760 },  // calendar year 2027
  "sun":   { "e": [...], "n": [...], "u": [...], "r_au": [...] },   // float32-ish, 5 decimals
  "earth": { "e": [...], "n": [...], "u": [...] },
  "grid": {
    "spacing_km": 1, "size": 11,
    "points": [ { "i": 0, "j": 0, "dx_km": -5, "dy_km": -5, "up_tilt": [tx, ty], "mask_deg": [360 values, 0.01° precision] } ]
  },
  "precomputed": { "center": { "year": { ...metrics }, "score": { ... } } }
}
```

Keep each file under ~3 MB. If it's larger, quantize (elevations as int16 hundredths of a degree) before considering a binary format.

## Curated sites

Coordinates are `TODO(astronomer)`: fill from NASA/LROC/mission sources and cite each one in `docs/VALIDATION.md`. Each site teaches something:

| id | name | why it's here |
| --- | --- | --- |
| apollo-11 | Apollo 11 | Equator baseline: Sun climbs high, Earth parked in the sky |
| chandrayaan-3 | Chandrayaan-3 | High-latitude landing that worked |
| im-1 | Intuitive Machines IM-1 (Malapert area) | Real CLPS pole lander that lost power early |
| shackleton-ridge | Shackleton connecting ridge | Among the most-lit terrain on the Moon |
| shackleton-floor | Inside Shackleton crater | Permanently shadowed: never lit |
| artemis-candidate | One Artemis III candidate region | "Where would you land?" |
| change-4 | Chang'e-4 (far side) | Earth never rises: why it needed a relay satellite |

## Frontend

Stack: Vite + TypeScript. The panorama is a raw `<canvas>` (2D context), not WebGL. React (or plain DOM) for panels. Static build deployable to GitHub Pages.

### Screens

1. **Site picker:** a south-pole map image (or a simple globe if time allows) with pins. Clicking a pin opens the panorama. Start with a static image and pins; a rotating globe is a stretch goal.
2. **Panorama view** (the core):
   - Full-width canvas showing 360° of horizon, draggable left/right with wraparound (draw the strip twice). Vertical scale is exaggerated (default 10×) with a **"True scale" toggle**; at true scale the Sun becomes a sliver on a flat line, which is a key demo moment.
   - Black sky with stars even when the Sun is up (no air). Terrain from the mask as layered silhouettes; ridge edges glow when the Sun is just behind them.
   - Sun and Earth drawn at **true angular size** (Earth ~4× wider than the Sun), with Earth showing the correct phase from the Sun–Earth angle.
   - Faint 29.5-day Sun track and Earth libration loop.
   - **Compass strip** across the top with arrows pointing to the Sun or Earth when they're off-screen.
   - A lander silhouette in the foreground whose solar panel lights up or goes dark.
   - Contextual tips pinned to objects (Sun, Earth, a peak), one at a time, plus a 4-step first-visit tour.
3. **Time slider** under the panorama: the track itself is colored by state (gold = sunlit, blue = Earth visible, green = both). Play/pause, speed (1 day/s, 1 week/s), "next sunrise" and "next Earthrise" jump buttons. Pressing play fast-forwards a month in ~20 s.
4. **Stats panel:**
   - Headline answer card: **"Can my lander survive here?"** with days survived and % time in contact.
   - **Battery icon** (power) and **signal bars 0–4** (Earth contact) that update live with the slider; "No service" when Earth is hidden.
   - **Site Score** grade with its credit-report factors.
   - **Lunar forecast** line: "Sunny for 3 more days, then a 4-day night. Earth signal: spotty this week."
   - Countdowns: sunset or sunrise, Earthset or Earthrise.
   - Panel comparison: horizontal vs vertical vs tracking.   - **Simple / Planner toggle:** same data, two label sets. Simple: "Sunny 71% of the month". Planner: "Illumination 0.71 (30 d, 1 h step, 3 m panel)". The real number always sits next to any metaphor.
5. **Location picker (mini-map):** the 11 × 11 grid around the site, colored by % sunlit. Clicking a cell moves the viewer there instantly (the browser recomputes from the shared vectors plus that point's mask).

### Visual style

Mission-control HUD: dark background, thin lines, monospace numbers, one warm accent (Sun gold) and one cool accent (Earth blue), green for "both". Accessible contrast (4.5:1 for text), and color is never the only signal (icons and labels too). It has to look good in a screen recording at 1080p.

## Validation (Validity is our strongest criterion)

Write results into `docs/VALIDATION.md` as tables the project page can reuse.

1. **Horizon unit tests** on synthetic terrain:
   - perfectly smooth sphere → horizon equals the geometric dip for the mast height (≈ `−acos(R/(R+h))`)
   - a single cone mountain at known distance → matches the analytic angle
2. **Ephemeris vs JPL Horizons:** for 3 sites × 5 times, Sun and Earth az/el from our code vs Horizons (topocentric on body 301). Expect agreement well under 0.1°.
3. **Sanity checks:** pole site Sun elevation stays within about ±1.6°; far-side site Earth is never visible; equator site Earth moves only a few degrees.
4. **Published illumination:** compare our % sunlit at well-known south-pole points against values in published LOLA illumination studies. `TODO(astronomer)`: pick the papers and points, then fill in the table: site, published %, ours, difference, likely reasons.
5. **Python ↔ TypeScript parity:** a fixture JSON with expected metrics, tested in both languages.
6. A short **"Limits"** section: DEM resolution, 1-hour sampling, mast height, fixed 150 km range, and Score weights as a design choice.

## Milestones (build in this order)

1. **Skeleton:** repo layout, Python env, Vite app, one hand-written fake `site.json`, and a panorama that draws a fake mask with a Sun dot. Drag and wraparound work.
2. **Real ephemeris:** `ephemeris.py` + Horizons check + tests. Real Sun/Earth vectors for one site in the JSON.
3. **Real horizon:** `horizon.py` + synthetic tests. Real mask for one site center.
4. **Time + metrics:** slider, play, colored track, countdowns, % stats, battery and signal icons. Python and TS metrics match.
5. **All sites + grid:** 7 curated sites, 11 × 11 grids, mini-map location picker, site picker screen.
6. **Approachability layer:** Site Score + factors, forecast line, Simple/Planner toggle, true-scale toggle, tips and tour.
7. **Polish:** stars, Earth phase, glowing ridges, lander silhouette, HUD styling. Deploy to GitHub Pages.
8. **Docs:** METHODS.md and VALIDATION.md filled in; README with a GIF and the team name only.

Stretch goals, in order, only after milestone 8: optional "Raise the mast" control (3–30 m, site center only; see Horizon mask), "Land and survive" game mode, a shareable site trading card PNG, a rotating 3D globe picker.

## Demo video notes

Captioned screen recording only. No faces, no voices, no names, and no visible usernames, file paths or browser profiles. Story: pick a pole site → look around → press play and watch the Sun circle the horizon → true-scale toggle → move 1 km on the mini-map and watch the grade change → Site Score and forecast → validation table on screen.
