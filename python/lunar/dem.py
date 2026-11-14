"""Read LOLA south-pole elevation maps (GeoTIFF, polar stereographic).

Data: NASA GSFC PGDA LOLA south-pole products (Barker et al. 2023, PSJ 4, 183,
doi:10.3847/PSJ/acf3e1). Heights are in metres relative to a sphere of radius
1737.4 km (the map's own datum), in the MOON_ME frame.

  near map: LDEM_80S_20MPP_ADJ   20 m/pixel, 80-90 S (square, corners reach further)
  far map:  LDEM_60S_240MPP_ADJ 240 m/pixel, 60-90 S, used where the near map has no data
"""

from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

R_MOON_M = 1737400.0  # datum radius of the maps (from the file's CRS)

DEM_DIR = Path(__file__).resolve().parents[1] / "data" / "dem"
NEAR_NAMES = ["LDEM_80S_20MPP_ADJ.TIF", "LDEM_80S_20MPP_ADJ.tiff"]
FAR_NAMES = ["LDEM_60S_240MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.tiff"]


def find_dem(names: list[str], dem_dir: Path = DEM_DIR) -> Path:
    for name in names:
        if (dem_dir / name).exists():
            return dem_dir / name
    raise FileNotFoundError(f"None of {names} in {dem_dir}. Run python/scripts/fetch_data.sh dem")


# ---- South polar stereographic projection (sphere, true scale at the pole) ----
# Matches the maps' CRS: +proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400.

def polar_stereo_xy(lat_deg, lon_deg, R: float = R_MOON_M):
    """Latitude/longitude (deg) -> map x, y (metres)."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    rho = 2.0 * R * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


def polar_stereo_latlon(x, y, R: float = R_MOON_M):
    """Map x, y (metres) -> latitude, longitude (deg). Inverse of polar_stereo_xy."""
    rho = np.hypot(x, y)
    lat = 2.0 * np.arctan(rho / (2.0 * R)) - np.pi / 2
    lon = np.arctan2(x, y)
    return np.degrees(lat), np.degrees(lon) % 360.0


class PolarDEM:
    """A window of a polar-stereographic elevation map around one site.

    Only the window is read into memory (the full 20 m map is ~3.7 GB).
    Call it like a function: dem(lat, lon) -> height in metres (NaN = no data).
    """

    EXPECTED_PROJ = {"proj": "stere", "lat_0": -90, "lon_0": 0, "R": R_MOON_M}

    def __init__(self, path: Path, center_lat: float, center_lon: float, radius_km: float = 160.0):
        self.path = Path(path)
        with rasterio.open(self.path) as src:
            self._check_crs(src.crs.to_dict())
            t = src.transform
            if t.b != 0 or t.d != 0:
                raise ValueError("Rotated map transforms are not supported.")
            cx, cy = polar_stereo_xy(center_lat, center_lon)
            r = radius_km * 1000.0
            b = src.bounds
            left, right = max(cx - r, b.left), min(cx + r, b.right)
            bottom, top = max(cy - r, b.bottom), min(cy + r, b.top)
            window = from_bounds(left, bottom, right, top, transform=t).round_offsets().round_lengths()
            self.data = src.read(1, window=window).astype(np.float32)
            wt = src.window_transform(window)
            if src.nodata is not None and not np.isnan(src.nodata):
                self.data[self.data == src.nodata] = np.nan
        # Pixel (col, row) covers x in [x0 + col*dx, x0 + (col+1)*dx]; its center is +0.5.
        self.x0, self.dx = wt.c, wt.a
        self.y0, self.dy = wt.f, wt.e  # dy is negative (rows go south in y)
        self.resolution_m = abs(self.dx)

    def _check_crs(self, crs: dict) -> None:
        for key, value in self.EXPECTED_PROJ.items():
            got = crs.get(key)
            ok = got == value if isinstance(value, str) else got is not None and abs(float(got) - value) < 1e-6
            if not ok:
                raise ValueError(f"{self.path.name}: unexpected CRS {key}={got!r} (expected {value!r})")

    def height_xy(self, x, y):
        """Bilinear height (m) at map coordinates; NaN outside the window or in holes."""
        col = (np.asarray(x, float) - self.x0) / self.dx - 0.5
        row = (np.asarray(y, float) - self.y0) / self.dy - 0.5
        c0, r0 = np.floor(col).astype(int), np.floor(row).astype(int)
        fc, fr = col - c0, row - r0
        h, w = self.data.shape
        inside = (c0 >= 0) & (r0 >= 0) & (c0 + 1 < w) & (r0 + 1 < h)
        c0, r0 = np.where(inside, c0, 0), np.where(inside, r0, 0)
        d = self.data
        z = (d[r0, c0] * (1 - fc) * (1 - fr) + d[r0, c0 + 1] * fc * (1 - fr)
             + d[r0 + 1, c0] * (1 - fc) * fr + d[r0 + 1, c0 + 1] * fc * fr)
        return np.where(inside, z, np.nan)

    def __call__(self, lat_deg, lon_deg):
        return self.height_xy(*polar_stereo_xy(lat_deg, lon_deg))


class TwoLevelDEM:
    """Use the near (detailed) map, falling back to the far map where it has no data."""

    def __init__(self, near, far):
        self.near, self.far = near, far

    def __call__(self, lat_deg, lon_deg):
        lat, lon = np.broadcast_arrays(np.asarray(lat_deg, float), np.asarray(lon_deg, float))
        h = np.array(self.near(lat, lon), dtype=float)
        missing = np.isnan(h)
        if missing.any():
            h[missing] = self.far(lat[missing], lon[missing])
        return h


def load_site_dem(lat: float, lon: float, radius_km: float = 160.0) -> TwoLevelDEM:
    """Near + far elevation maps around a site."""
    near = PolarDEM(find_dem(NEAR_NAMES), lat, lon, radius_km)
    far = PolarDEM(find_dem(FAR_NAMES), lat, lon, radius_km)
    return TwoLevelDEM(near, far)
