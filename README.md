# Lunar Landing Site Navigator

**Can my lander survive here?** Stand at a candidate landing site near the Moon's south pole, look around in 360°, and see when you'd have solar power and when you could talk to Earth.

NASA Space Apps 2026 · Team **T^2 = Ka^3**

> Work in progress. Sun/Earth positions (validated against JPL Horizons) and horizons from LOLA elevation maps are real for all nine sites: Malapert Massif, Mons Mouton, Mons Mouton Plateau, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Haworth, Peak near Cabeus B and Slater Plain, using LOLA 5 m site maps where available (10 m crops for Cabeus B and Slater Plain). Each has an 11 × 11 grid of spots 1 km apart: pick a site on the 3D Moon and stand there, then move between spots from the grid in the sidebar. Press play to watch a month go by: the time bar, power, Earth contact and statistics all update.

## Develop

Python (offline precompute, Python ≥ 3.11):

```sh
python3.12 -m venv python/.venv
python/.venv/bin/pip install -e "python[dev]"
python/.venv/bin/pytest python/tests
python/scripts/fetch_data.sh kernels  # ~45 MB of SPICE kernels (not committed)
python/scripts/fetch_data.sh dem      # ~2.8 GB of LOLA elevation maps (NASA GSFC PGDA)
python/.venv/bin/python python/scripts/build_site.py --site nobile-rim-2 --site haworth   # JSON + _terrain.bin, ~6 s per site
python/.venv/bin/python python/scripts/validate_horizons.py   # table for docs/VALIDATION.md
python/.venv/bin/python python/scripts/make_metrics_fixture.py  # Python <-> TS metrics fixture
```

Web (static site):

```sh
cd web
npm install
npm run skin     # optional pixel UI skin: needs the Sprout Lands UI Basic pack unzipped in ~/Downloads
                 #  (or SPROUT_DIR=...); without it the app uses the plain CSS look
npm run dev      # http://localhost:5173  (a site: /?site=nobile-rim-2; &pt=i,j stands i km east, j km north of its center;
                 #  &hour=N opens at hour N of 2027, &view=2d for the strip; the picker zoomed onto a site: /?focus=haworth)
npm test
npm run build    # -> web/dist
```

See `spec.MD` for the full brief, `docs/METHODS.md` and `docs/VALIDATION.md` for the physics.

## Credits

UI sprites come from the [Sprout Lands UI Pack (Basic)](https://cupnooble.itch.io) by Cup Nooble,
free for non-commercial use. Its licence forbids redistributing the sprites, so they are not in this repo:
`npm run skin` (`web/scripts/build-sprout-skin.mjs`) crops and recolours them from your own copy of the pack
into the gitignored `web/src/assets/ui-sprout/`, and `web/src/skin.css` 9-slices them.
