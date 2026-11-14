# Lunar Landing Site Navigator

**Can my lander survive here?** Stand at a candidate landing site near the Moon's south pole, look around in 360°, and see when you'd have solar power and when you could talk to Earth.

NASA Space Apps 2026 · Team **T^2 = Ka^3**

> Work in progress. Milestone 1 (skeleton) shows **fake** terrain only.

## Develop

Python (offline precompute, Python ≥ 3.11):

```sh
python3.12 -m venv python/.venv
python/.venv/bin/pip install -e "python[dev]"
python/.venv/bin/pytest python/tests
python/scripts/fetch_data.sh          # ~2 GB of SPICE kernels + LOLA DEMs (not committed)
python/.venv/bin/python python/scripts/make_fake_site.py
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
