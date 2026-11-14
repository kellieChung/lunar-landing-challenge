# Lunar Landing Site Navigator

**Can my lander survive here?** Stand at a candidate landing site near the Moon's south pole, look around in 360°, and see when you'd have solar power and when you could talk to Earth.

NASA Space Apps 2026 · Team **T^2 = Ka^3**

> Work in progress. Sun/Earth positions are real (validated against JPL Horizons); the terrain is still made up until milestone 3.

## Develop

Python (offline precompute, Python ≥ 3.11):

```sh
python3.12 -m venv python/.venv
python/.venv/bin/pip install -e "python[dev]"
python/.venv/bin/pytest python/tests
python/scripts/fetch_data.sh kernels  # ~45 MB of SPICE kernels (not committed)
python/scripts/fetch_data.sh dem      # ~2 GB of LOLA elevation maps (milestone 3)
python/.venv/bin/python python/scripts/build_site.py --site artemis-candidate
python/.venv/bin/python python/scripts/validate_horizons.py   # table for docs/VALIDATION.md
```

Web (static site):

```sh
cd web
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # -> web/dist
```

See `spec.MD` for the full brief, `docs/METHODS.md` and `docs/VALIDATION.md` for the physics.
