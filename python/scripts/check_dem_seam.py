"""Compare the near (20 m) and far (240 m) maps where both have data, and each
5 m site tile against the 20 m map in a 1 km band inside the tile's edge
(where the two are blended).

They come from the same LOLA dataset, so heights should agree apart from
detail the 240 m map smooths out. A large systematic offset would mean a
reference or projection mismatch.

    python/.venv/bin/python python/scripts/check_dem_seam.py --site nobile-rim-2
"""

import argparse

import numpy as np

from lunar.dem import load_site_dem
from lunar.ephemeris import site_frame
from lunar.horizon import unit_vector
from lunar.sites import get_site

R = 1737400.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    args = parser.parse_args()
    site = get_site(args.site)
    dem = load_site_dem(site.lat, site.lon)
    east, north, up = site_frame(site.lat, site.lon)

    rng = np.random.default_rng(0)  # fixed seed: reproducible
    n = 200_000
    az = rng.uniform(0, 2 * np.pi, n)
    dist = np.sqrt(rng.uniform(0, 150_000**2, n))  # uniform over the disk
    t = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east
    ang = dist / R
    v = np.cos(ang)[:, None] * up + np.sin(ang)[:, None] * t
    lat = np.degrees(np.arcsin(v[:, 2]))
    lon = np.degrees(np.arctan2(v[:, 1], v[:, 0]))

    near, far = dem.near(lat, lon), dem.far(lat, lon)
    both = ~np.isnan(near) & ~np.isnan(far)
    diff = near[both] - far[both]
    print(f"points compared: {both.sum()} of {n} (near map missing at {np.isnan(near).sum()})")
    print(f"near - far: mean {diff.mean():.2f} m, median {np.median(diff):.2f} m, "
          f"|diff| 95th pct {np.percentile(np.abs(diff), 95):.1f} m, max |diff| {np.abs(diff).max():.0f} m")

    for tile in dem.detail:
        b = tile.bounds
        xs = rng.uniform(b.left, b.right, n)
        ys = rng.uniform(b.bottom, b.top, n)
        edge = np.minimum(np.minimum(xs - b.left, b.right - xs), np.minimum(ys - b.bottom, b.top - ys))
        band = (edge > tile.resolution_m) & (edge < 1000.0)
        fine, coarse = tile.height_xy(xs[band], ys[band]), dem.near.height_xy(xs[band], ys[band])
        ok = ~np.isnan(fine) & ~np.isnan(coarse)
        d = fine[ok] - coarse[ok]
        print(f"{tile.path.name} - 20 m map, 1 km band inside the tile edge ({ok.sum()} points): "
              f"mean {d.mean():.2f} m, median {np.median(d):.2f} m, "
              f"|diff| 95th pct {np.percentile(np.abs(d), 95):.1f} m, max |diff| {np.abs(d).max():.0f} m")


if __name__ == "__main__":
    main()
