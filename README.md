# H.A.L.O.sim: Lunar Landing Site Navigator

**Can my lander survive here?** Stand at a candidate landing site near the Moon's south pole, look around in 360°, and see when you'd have solar power and when you could talk to Earth.

NASA Space Apps 2026 · Team **T^2 = Ka^3** · H.A.L.O. = Horizon and Lunar Orbital Simulator

Sun/Earth positions (validated against JPL Horizons) and horizons from LOLA elevation maps are real for all nine sites: Malapert Massif, Mons Mouton, Mons Mouton Plateau, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Haworth, Peak near Cabeus B and Slater Plain, using LOLA 5 m site maps where available (10 m crops for Cabeus B and Slater Plain). Each has an 11 × 11 grid of spots 1 km apart: pick a site on the 3D Moon and stand there, then move between spots from the grid in the sidebar. Press play to watch a month go by: the time bar, power, Earth contact and statistics all update. Raise the solar panel and antenna on a taller mast (3–30 m) to see how much a tower helps.

**Moon Base mode** (game, ages ~9–13): switch a site from **Explore** to **Moon Base** in the top bar (or `&mode=game`). Your lander's fuel tank is leaking, so you have to make rocket fuel from Moon ice to fly home. Compare three landing spots by going to look at them in 3D and on the timeline, land, and see what each spot really had, how each would have turned out (a replay on the real sky) and which ridge hid the Sun. Then pick a crater (ice lasts only on floors the Sun never or barely reaches), let rovers driven from Earth dig while Earth is in view, and spend the leftover dry dirt on landing pads (Earth sends a rover, a solar tower or a battery) and base upgrades (dirt cover, packed roads, dirt-lined oven). Fill the tank within three Sun circuits (89 days) to launch; each site you complete unlocks the next. 8 of the 9 sites host ice runs; Malapert Massif has no floor dark enough nearby. Sunlight, Earth contact and slopes are the app's real physics; ice amounts and the machines are labelled hypothetical. Design: `game.MD`; numbers: `docs/METHODS.md` (Moon Base mode).

## Develop

Python (offline precompute, Python ≥ 3.11):

```sh
python3.12 -m venv python/.venv
python/.venv/bin/pip install -e "python[dev]"
python/.venv/bin/pytest python/tests
python/scripts/fetch_data.sh kernels  # ~60 MB of SPICE kernels (not committed)
python/scripts/fetch_data.sh dem      # ~2.8 GB of LOLA elevation maps (NASA GSFC PGDA)
python/.venv/bin/python python/scripts/build_site.py --site nobile-rim-2 --site haworth   # JSON + _terrain.bin, ~6 s per site
python/.venv/bin/python python/scripts/validate_horizons.py   # table for docs/VALIDATION.md
python/.venv/bin/python python/scripts/validate_multiyear.py  # 2026-2044 and eclipse tables for docs/VALIDATION.md
python/.venv/bin/python python/scripts/build_optimized_moon.py  # the globe: web/public/models/moon.glb from NASA's 8k Moon model
                                                                 #  (python/data/Moon_NASA_LRO_8k_Topo.glb) and the 240 m LOLA map
python/.venv/bin/python python/scripts/make_metrics_fixture.py  # Python <-> TS metrics fixture
```

Web (static site):

```sh
cd web
npm install
npm run skin     # optional pixel art + sounds: needs the Sprout Lands packs unzipped in ~/Downloads
                 #  (or SPROUT_DIR=...); without it the app uses the plain CSS look
npm run dev      # http://localhost:5173  (a site: /?site=nobile-rim-2; &pt=i,j stands i km east, j km north of its center;
                 #  &hour=N opens at hour N of 2027, &view=2d for the strip;
                 #  &mast=5|10|20|30 raises the solar panel and antenna; the picker zoomed onto a site: /?focus=haworth)
npm test
npm run build    # -> web/dist
```

## Deploy (Vercel)

Vercel project: Root Directory `web`, preset Vite (`web/vercel.json`). **Every push to `main` deploys automatically, with the pixel skin.** The Sprout Lands licence forbids redistributing the art, so the generated skin lives in a **private** repo (`kellieChung/lunar-landing-skin`). `npm run build` runs `scripts/fetch-skin.mjs` first: on Vercel it downloads the skin with `SKIN_TOKEN`, and if that fails the build fails, so a plain-look build never goes live. Locally it uses your own `npm run skin` output.

One-time setup:

1. On GitHub, create an empty **private** repo `lunar-landing-skin` (no README).
2. `cd web && npm run skin && npm run skin:publish` pushes the generated skin into its `ui-sprout/` folder (anything else in the repo, e.g. the raw packs, is left alone and ignored by the build). Run the same after any skin change.
3. GitHub → Settings → Developer settings → Fine-grained tokens: give it access to *only* `lunar-landing-skin`, with **Contents: Read-only**.
4. Vercel project → Settings → Environment Variables: `SKIN_TOKEN` = that token (Production + Preview). Then redeploy.

Manual deploys from a Mac with the skin still work: `npm run deploy:preview` / `npm run deploy` (after `npx vercel link`).

`web/vercel.json` sets a 1-hour cache for the `data/` and `models/` files. No rewrites are needed because routes are query parameters on `/`.

See `spec.MD` for the design, `game.MD` for the Moon Base game, and `docs/METHODS.md` and `docs/VALIDATION.md` for the physics and how it was checked.

## Credits

Assets from Sprout Lands by [Cup Nooble](https://cupnooble.itch.io): the UI Pack (Basic), the Sprites
pack (Basic) and the Sorry pack (frames, icons, the mascot, chests, ice, fire and sounds), free for
non-commercial use. The licences forbid redistributing them, so they are not in this repo:
`npm run skin` (`web/scripts/build-sprout-skin.mjs`) crops and recolours them from your own copies
(`SPROUT_DIR`, `SPROUT_SPRITES_DIR`, `SPROUT_SORRY_DIR`, default `~/Downloads/...`) into the gitignored
`web/src/assets/ui-sprout/`. `web/src/skin.css` and `web/src/game/game.css` 9-slice them; without them the
app and the game fall back to plain frames and words.
