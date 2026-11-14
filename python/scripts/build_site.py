"""Build web/public/data/<site_id>.json for one curated site.

    python/.venv/bin/python python/scripts/build_site.py --site nobile-rim-2

Real Sun/Earth vectors for calendar year 2027 (hourly) and the real horizon
mask at the site center from the LOLA elevation maps. For the 3D view it also
writes the horizon split into distance bands and <site_id>_terrain.bin, a
10 x 10 km heightmap around the center (rendering only, never physics).
precomputed.center.year holds the full-year metrics at the site center,
computed from the rounded numbers in the file so the browser gets the same.
TODO(milestone 5): 11 x 11 grid of points around the center.
"""

import argparse
import json
from pathlib import Path

from lunar import ephemeris as E
from lunar.dem import load_site_dem
from lunar.horizon import BAND_EDGES_KM, horizon_mask
from lunar.metrics import rounded_metrics, site_series, window_metrics
from lunar.sites import get_site
from lunar.terrain import terrain_grid

from build_sites_index import write_index

WEB_DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
START = "2027-01-01T00:00:00Z"
COUNT = 8760  # hours in 2027
STEP_HOURS = 1
MAST_HEIGHT_M = 3.0


def r5(values) -> list[float]:
    return [round(float(v), 5) for v in values]


def r2(values) -> list[float]:
    return [round(float(v), 2) for v in values]


def build(site_id: str) -> Path:
    site = get_site(site_id)
    frame = E.site_frame(site.lat, site.lon)
    dem = load_site_dem(site.lat, site.lon)
    hz = horizon_mask(site.lat, site.lon, dem, frame=frame, observer_height_m=MAST_HEIGHT_M)
    if hz.skipped:
        print(f"warning: {hz.skipped} terrain samples had no data in either map (ignored)")

    terrain = terrain_grid(site.lat, site.lon, dem, frame=frame, ground_m=hz.ground_m)
    terrain_name = f"{site.id}_terrain.bin"

    E.load_kernels()
    eph = E.site_ephemeris(site.lat, site.lon, START, COUNT, STEP_HOURS, MAST_HEIGHT_M,
                           ground_m=hz.ground_m)

    data = {
        "site": {"id": site.id, "name": site.name, "lat": site.lat, "lon": site.lon,
                 "kind": site.kind, "blurb": site.blurb,
                 "ground_height_m": round(hz.ground_m, 1), "mast_height_m": MAST_HEIGHT_M},
        "frame": {"description": "site-center ENU, azimuth from grid north"},
        "time": {"start": START, "step_hours": STEP_HOURS, "count": COUNT},
        "sun": {k: r5(v) for k, v in eph["sun"].items()},
        "earth": {**{k: r5(eph["earth"][k]) for k in ("e", "n", "u")},
                  "r_km": [round(float(v), 1) for v in eph["earth"]["r_km"]]},
        "grid": {
            "spacing_km": 1, "size": 1,
            "mask_bands_km": [[lo, hi] for lo, hi in zip(BAND_EDGES_KM[:-1], BAND_EDGES_KM[1:])],
            "points": [{"i": 0, "j": 0, "dx_km": 0, "dy_km": 0,
                        "up_tilt": [0.0, 0.0],
                        "mask_deg": r2(hz.mask_deg),
                        "mask_bands_deg": [r2(b) for b in hz.bands_deg]}],
        },
        "terrain": terrain.header(terrain_name),
    }
    # Metrics from exactly what the browser will read (rounded vectors and mask).
    center = data["grid"]["points"][0]
    series = site_series(data["sun"], data["earth"], center["mask_deg"])
    data["precomputed"] = {"center": {"year": rounded_metrics(window_metrics(series, 0, COUNT, STEP_HOURS))}}
    out = WEB_DATA / f"{site.id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False))
    terrain.heights_m.astype("<f4").tofile(WEB_DATA / terrain_name)
    print(f"wrote {WEB_DATA / terrain_name} ({terrain.heights_m.shape[1]} x {terrain.heights_m.shape[0]}, "
          f"heights {terrain.heights_m.min():.0f} to {terrain.heights_m.max():.0f} m)")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, help="site id from lunar/sites.py")
    args = parser.parse_args()
    out = build(args.site)
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")
    print(f"wrote {write_index()}")


if __name__ == "__main__":
    main()
