"""Build web/public/data/<site_id>.json for one curated site.

    python/.venv/bin/python python/scripts/build_site.py --site nobile-rim-2 [--site haworth ...]

Real Sun/Earth vectors for calendar year 2027 (hourly, at the site center) and
real horizon masks from the LOLA elevation maps for an 11 x 11 grid of points
1 km apart around the center (lunar/grid.py). Each point also stores its own
"up" tilt so the browser can measure Sun/Earth elevations against it.
For the 3D view it also writes each point's horizon split into distance bands
and <site_id>_terrain.bin, a 20 x 20 km heightmap around the center, so every
grid point has at least 5 km of ground around it, plus <site_id>_detail.bin, a
13 x 13 km heightmap at 10 m (int16, 0.1 m steps) that the browser crops to a
3 x 3 km patch around the chosen point (rendering only, never physics).
Heights come from the same map stack as the horizons: any 5 m site tiles in
python/data/dem, then the 20 m and 240 m maps (lunar/dem.py).
precomputed.points[k].year holds the full-year metrics at each point (and
precomputed.center.year at the center), computed from the rounded numbers in
the file exactly as the browser does, so both get the same answers.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from lunar import ephemeris as E
from lunar.dem import load_site_dem
from lunar.grid import GRID_SIZE, GRID_SPACING_KM, grid_offsets, point_latlon, point_up, point_vectors, up_tilt
from lunar.horizon import BAND_EDGES_KM, horizon_mask
from lunar.metrics import rounded_metrics, site_series, window_metrics
from lunar.sites import get_site
from lunar.terrain import int16_scale, terrain_grid, to_int16

from build_sites_index import write_index

WEB_DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
START = "2027-01-01T00:00:00Z"
COUNT = 8760  # hours in 2027
STEP_HOURS = 1
MAST_HEIGHT_M = 3.0
TERRAIN_HALF_M = 10_000.0  # 20 x 20 km: >= 5 km of ground around every grid point
DETAIL_HALF_M = 6_500.0  # the grid (+/-5 km) plus a 1.5 km patch radius
DETAIL_SPACING_M = 10.0
TILT_DIGITS = 8


def r5(values) -> list[float]:
    return [round(float(v), 5) for v in values]


def r2(values) -> list[float]:
    return [round(float(v), 2) for v in values]


def grid_points(site, frame, dem, ground_c: float) -> list[dict]:
    """Horizon masks for the 11 x 11 grid around the site center."""
    points = []
    offsets = grid_offsets()
    t0 = time.time()
    for k, (i, j, dx_km, dy_km) in enumerate(offsets):
        if i == 0 and j == 0:  # exactly the site (no round trip through the projection)
            lat, lon, tilt = site.lat, site.lon, (0.0, 0.0)
        else:
            up_p = point_up(dx_km * 1000.0, dy_km * 1000.0, frame, ground_c)
            lat, lon = point_latlon(dx_km * 1000.0, dy_km * 1000.0, frame, ground_c)
            tilt = up_tilt(up_p, frame)
        hz = horizon_mask(lat, lon, dem, frame=frame, observer_height_m=MAST_HEIGHT_M)
        if hz.skipped:
            print(f"warning: point ({i},{j}): {hz.skipped} terrain samples had no data (ignored)")
        points.append({"i": i, "j": j, "dx_km": dx_km, "dy_km": dy_km,
                       # The center keeps the site's exact coordinates; others are rounded.
                       "lat": lat if (i, j) == (0, 0) else round(lat, 6),
                       "lon": lon if (i, j) == (0, 0) else round(lon, 6),
                       "ground_m": round(hz.ground_m, 1),
                       "up_tilt": [round(float(x), TILT_DIGITS) for x in tilt],
                       "mask_deg": r2(hz.mask_deg),
                       "mask_bands_deg": [r2(b) for b in hz.bands_deg]})
        if (k + 1) % 11 == 0:
            print(f"  {site.id}: {k + 1}/{len(offsets)} points ({time.time() - t0:.0f} s)", flush=True)
    return points


def point_year(data: dict, p: dict) -> dict:
    """Full-year metrics at one grid point, from exactly what the browser reads."""
    sun = point_vectors(data["sun"], p["up_tilt"])
    earth = point_vectors(data["earth"], p["up_tilt"])
    series = site_series(sun, earth, p["mask_deg"])
    return rounded_metrics(window_metrics(series, 0, COUNT, STEP_HOURS))


def build(site_id: str) -> Path:
    t0 = time.time()
    site = get_site(site_id)
    frame = E.site_frame(site.lat, site.lon)
    dem = load_site_dem(site.lat, site.lon)
    ground_c = float(dem(np.array([site.lat]), np.array([site.lon]))[0])
    points = grid_points(site, frame, dem, ground_c)
    center = next(p for p in points if p["dx_km"] == 0 and p["dy_km"] == 0)

    terrain = terrain_grid(site.lat, site.lon, dem, frame=frame, ground_m=ground_c, half_m=TERRAIN_HALF_M)
    terrain_name = f"{site.id}_terrain.bin"
    detail = terrain_grid(site.lat, site.lon, dem, frame=frame, ground_m=ground_c,
                          half_m=DETAIL_HALF_M, spacing_m=DETAIL_SPACING_M)
    detail_name = f"{site.id}_detail.bin"
    detail_scale = int16_scale(detail.heights_m)  # 0.1 m unless the relief is very tall
    detail_q = to_int16(detail.heights_m, detail_scale)

    E.load_kernels()
    eph = E.site_ephemeris(site.lat, site.lon, START, COUNT, STEP_HOURS, MAST_HEIGHT_M,
                           ground_m=ground_c)

    data = {
        "site": {"id": site.id, "name": site.name, "lat": site.lat, "lon": site.lon,
                 "kind": site.kind, "blurb": site.blurb, "source": site.source,
                 "ground_height_m": center["ground_m"], "mast_height_m": MAST_HEIGHT_M},
        "frame": {"description": "site-center ENU, azimuth from grid north; "
                                 "Sun/Earth vectors are for the site center, rotate them by a "
                                 "point's up_tilt (its up as [east, north] parts) to use them there"},
        "time": {"start": START, "step_hours": STEP_HOURS, "count": COUNT},
        "sun": {k: r5(v) for k, v in eph["sun"].items()},
        "earth": {**{k: r5(eph["earth"][k]) for k in ("e", "n", "u")},
                  "r_km": [round(float(v), 1) for v in eph["earth"]["r_km"]]},
        "grid": {
            "spacing_km": GRID_SPACING_KM, "size": GRID_SIZE,
            "mask_bands_km": [[lo, hi] for lo, hi in zip(BAND_EDGES_KM[:-1], BAND_EDGES_KM[1:])],
            "points": points,
        },
        "terrain": terrain.header(terrain_name),
        "terrain_detail": {**detail.header(detail_name, fmt="int16-le"), "scale_m": detail_scale,
                           "sources": [d.path.name for d in dem.detail] + [dem.near.path.name]},
    }
    # Metrics from exactly what the browser will read (rounded vectors, masks and tilts).
    years = [point_year(data, p) for p in points]
    data["precomputed"] = {
        "center": {"year": years[points.index(center)]},
        "points": [{"i": p["i"], "j": p["j"], "year": y} for p, y in zip(points, years)],
    }
    out = WEB_DATA / f"{site.id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False))
    terrain.heights_m.astype("<f4").tofile(WEB_DATA / terrain_name)
    detail_q.tofile(WEB_DATA / detail_name)
    print(f"wrote {WEB_DATA / detail_name} ({detail.heights_m.shape[1]} x {detail.heights_m.shape[0]} "
          f"at {DETAIL_SPACING_M:.0f} m, {(WEB_DATA / detail_name).stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {WEB_DATA / terrain_name} ({terrain.heights_m.shape[1]} x {terrain.heights_m.shape[0]}, "
          f"heights {terrain.heights_m.min():.0f} to {terrain.heights_m.max():.0f} m)")
    sunlit = [y["sunlit_pct"] for y in years]
    print(f"{site.id}: % sunlit over the grid {min(sunlit):.1f} .. {max(sunlit):.1f} "
          f"(center {data['precomputed']['center']['year']['sunlit_pct']:.1f}); "
          f"{time.time() - t0:.0f} s")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, action="append",
                        help="site id from lunar/sites.py (repeat for several)")
    args = parser.parse_args()
    for site_id in args.site:
        out = build(site_id)
        print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")
        print(f"wrote {write_index()}", flush=True)


if __name__ == "__main__":
    main()
