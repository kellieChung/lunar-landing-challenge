"""Cut 30 x 30 km windows of the LOLA 83-90 S 10 m/pixel map for sites with no 5 m tile.

    python/.venv/bin/python python/scripts/fetch_10mpp_crops.py [--site cabeus-b-peak ...] [--force]

LDEM_83S_10MPP_ADJ.TIF (NASA GSFC PGDA, Barker et al. 2023) is 5.1 GB, but it is
a tiled GeoTIFF on a server that supports range requests, so GDAL fetches only
the 512 x 512 tiles under the window (about 35 MB per site). Each crop is written
to python/data/dem/<site_id>_10mpp_crop.tif, where lunar/dem.py picks it up as a
site tile (stacked above the 20 m map, feathered at its edges).
"""

import argparse
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from lunar.dem import DEM_DIR, polar_stereo_xy
from lunar.sites import get_site

URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF"
HALF_M = 15_000.0  # 30 x 30 km: covers build_site.py's 20 x 20 km terrain with margin
DEFAULT_SITES = ["cabeus-b-peak", "slater-plain"]


def crop_path(site_id: str, dem_dir: Path = DEM_DIR) -> Path:
    return dem_dir / f"{site_id}_10mpp_crop.tif"


def fetch_crop(src, site_id: str, dest: Path) -> None:
    site = get_site(site_id)
    x, y = (float(v) for v in polar_stereo_xy(site.lat, site.lon))
    win = from_bounds(x - HALF_M, y - HALF_M, x + HALF_M, y + HALF_M, src.transform)
    win = win.round_offsets().round_lengths()
    data = src.read(1, window=win)
    profile = {
        "driver": "GTiff", "width": data.shape[1], "height": data.shape[0], "count": 1,
        "dtype": "float32", "crs": src.crs, "transform": src.window_transform(win),
        "nodata": np.nan, "tiled": True, "blockxsize": 512, "blockysize": 512,
        "compress": "deflate", "predictor": 3,
    }
    part = dest.with_name(dest.name + ".part")  # not *.tif, so the loader ignores it
    with rasterio.open(part, "w", **profile) as dst:
        dst.write(data.astype(np.float32), 1)
    os.replace(part, dest)
    print(f"wrote {dest} ({data.shape[1]} x {data.shape[0]} px, {dest.stat().st_size / 1e6:.1f} MB, "
          f"NaN {np.isnan(data).mean():.4f}, heights {np.nanmin(data):.1f} to {np.nanmax(data):.1f} m)",
          flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--site", action="append", help="site id from lunar/sites.py (repeatable)")
    parser.add_argument("--force", action="store_true", help="re-fetch crops that already exist")
    args = parser.parse_args()
    DEM_DIR.mkdir(parents=True, exist_ok=True)
    todo = []
    for site_id in args.site or DEFAULT_SITES:
        dest = crop_path(site_id)
        if dest.exists() and not args.force:
            print(f"have  {dest}")
        else:
            todo.append((site_id, dest))
    if not todo:
        return
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY=3,
                      GDAL_HTTP_RETRY_DELAY=2):
        with rasterio.open(URL) as src:
            for site_id, dest in todo:
                print(f"get   {site_id} window from {URL}", flush=True)
                fetch_crop(src, site_id, dest)


if __name__ == "__main__":
    main()
