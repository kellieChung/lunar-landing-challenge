"""Near-field heightmap around a site, for the 3D view (rendering only).

A square grid in the site frame (x = east, y = north), centered on the
observer. Each vertex stores the terrain height in metres measured along the
site-center "up" direction, relative to the observer's ground. Because it is
measured along one fixed "up", it includes the Moon's curvature: flat ground
5 km away sits about 7 m lower (about -d^2 / 2R).

For each vertex at (x, y):
    q   = (R + g) up + x east + y north      point on the observer's tangent plane
    dir = q / |q|                            straight down to the sphere
    h   = DEM height at dir
    z   = (R + h) dot(dir, up) - (R + g)

The terrain point (R + h) dir is shifted horizontally from (x, y) by at most
|x| |h - g| / R (about 2 m at 7 km for 500 m of relief), which is far below
the 100 m grid spacing and is ignored.

Physics never reads this file; it uses the horizon masks only.
"""

from dataclasses import dataclass

import numpy as np

from lunar.dem import R_MOON_M
from lunar.ephemeris import site_frame


@dataclass
class Terrain:
    heights_m: np.ndarray  # (ny, nx) float32; row j: y = y0 + j*spacing (south->north)
    x0_m: float  # x (east) of column 0
    y0_m: float  # y (north) of row 0
    spacing_m: float
    ground_m: float  # observer ground height relative to the DEM datum sphere

    def header(self, file_name: str, fmt: str = "float32-le") -> dict:
        ny, nx = self.heights_m.shape
        return {
            "file": file_name,
            "format": fmt,
            "nx": nx,
            "ny": ny,
            "spacing_m": self.spacing_m,
            "x0_m": self.x0_m,
            "y0_m": self.y0_m,
            "ground_m": round(self.ground_m, 1),
            "order": "row-major; row j: y = y0 + j*spacing (south->north); "
                     "column i: x = x0 + i*spacing (west->east)",
            "z": "metres along the site-center up vector, relative to the observer's ground "
                 "(0 at the center); includes the Moon's curvature",
        }


INT16_SCALE_M = 0.1  # detail heightmap: int16 in units of 0.1 m


def int16_scale(heights_m: np.ndarray, base_m: float = INT16_SCALE_M) -> float:
    """base_m, or the smallest multiple of it that fits the heights in int16 (very tall relief)."""
    need = float(np.abs(heights_m).max()) / np.iinfo(np.int16).max
    return base_m * max(1, int(np.ceil(need / base_m - 1e-12)))


def to_int16(heights_m: np.ndarray, scale_m: float = INT16_SCALE_M) -> np.ndarray:
    """Quantize heights to little-endian int16 steps of scale_m. Raises if any value doesn't fit."""
    q = np.round(np.asarray(heights_m, float) / scale_m)
    lim = np.iinfo(np.int16)
    if q.min() < lim.min or q.max() > lim.max:
        raise ValueError(f"Heights {heights_m.min():.0f}..{heights_m.max():.0f} m don't fit int16 "
                         f"at {scale_m} m per step (max +/-{lim.max * scale_m:.0f} m).")
    return q.astype("<i2")


def terrain_grid(lat_deg: float, lon_deg: float, height_fn, frame=None,
                 ground_m: float | None = None, half_m: float = 5000.0,
                 spacing_m: float = 100.0, radius_m: float = R_MOON_M) -> Terrain:
    """Heightmap of (2*half_m/spacing_m + 1)^2 vertices around a site.

    height_fn(lat, lon) -> terrain height in metres (vectorized; NaN = no data).
    frame: (east, north, up) of the site frame; defaults to the site's own.
    ground_m: observer ground height; looked up from height_fn if not given.
    """
    east, north, up = frame if frame is not None else site_frame(lat_deg, lon_deg)
    if ground_m is None:
        ground_m = float(height_fn(np.array([lat_deg]), np.array([lon_deg]))[0])
    n = int(round(2 * half_m / spacing_m)) + 1
    coords = -half_m + spacing_m * np.arange(n)
    x, y = np.meshgrid(coords, coords)  # x varies along columns, y along rows

    base = radius_m + ground_m
    q = base * up + x[..., None] * east + y[..., None] * north  # (n, n, 3)
    dirs = q / np.linalg.norm(q, axis=-1, keepdims=True)
    lat_s = np.degrees(np.arcsin(np.clip(dirs[..., 2], -1, 1)))
    lon_s = np.degrees(np.arctan2(dirs[..., 1], dirs[..., 0]))
    h = np.asarray(height_fn(lat_s, lon_s), float)
    if np.isnan(h).any():
        raise ValueError(f"{int(np.isnan(h).sum())} heightmap vertices have no terrain data.")

    z = (radius_m + h) * (dirs @ up) - base
    return Terrain(heights_m=z.astype(np.float32), x0_m=float(coords[0]), y0_m=float(coords[0]),
                   spacing_m=float(spacing_m), ground_m=float(ground_m))
