"""Read LOLA south-pole elevation maps (GeoTIFF, polar stereographic).

Data: NASA GSFC PGDA LOLA south-pole products (Barker et al. 2023, PSJ 4, 183,
doi:10.3847/PSJ/acf3e1). Heights are in metres relative to a sphere of radius
1737.4 km (the map's own datum), in the MOON_ME frame.

  site tiles: *_5mpp_surf.tif     5 m/pixel, ~20 x 20 km tiles around candidate sites
                                  (downloaded by hand into data/dem; any number, optional)
              *_10mpp_crop.tif   10 m/pixel, 30 x 30 km windows of LDEM_83S_10MPP_ADJ for
                                  sites without a 5 m tile (scripts/fetch_10mpp_crops.py)
  near map: LDEM_80S_20MPP_ADJ   20 m/pixel, 80-90 S (square, corners reach further)
  far map:  LDEM_60S_240MPP_ADJ 240 m/pixel, 60-90 S, used where the near map has no data

They are stacked finest first (LayeredDEM). Near a site tile's edge its
heights blend into the 20 m map over DETAIL_FEATHER_M, so there is no step.

Some site tiles carry bad-data spikes: a few pixels 30-100 m above or below
the ground around them (e.g. DM2, Nobile Rim 2). Where a pixel stands out
both from its own surroundings and from the 20 m map, it and its flanks take
the 20 m map's heights instead (despike_tile).
"""

from pathlib import Path

import warnings

import numpy as np
import rasterio
from rasterio.windows import from_bounds

R_MOON_M = 1737400.0  # datum radius of the maps (from the file's CRS)

DEM_DIR = Path(__file__).resolve().parents[1] / "data" / "dem"
NEAR_NAMES = ["LDEM_80S_20MPP_ADJ.TIF", "LDEM_80S_20MPP_ADJ.tiff"]
FAR_NAMES = ["LDEM_60S_240MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.tiff"]
DETAIL_PATTERNS = ["*5mpp*", "*10mpp*"]  # e.g. SL2_final_adj_5mpp_surf.tif, slater-plain_10mpp_crop.tif
DETAIL_FEATHER_M = 200.0  # blend width at a site tile's edge
DETAIL_REACH_KM = 20.0  # use a site tile if it comes this close to the site
SPIKE_M = 25.0  # a tile pixel this far from both its 60 m ring and the 20 m map is bad data
SPIKE_RING_M = 60.0
SPIKE_EDGE_M = 5.0  # the replaced patch grows until the tile is back within this of the 20 m map
SPIKE_MAX_GROW_M = 200.0


def find_detail_tiles(dem_dir: Path = DEM_DIR) -> list[Path]:
    """All 5 m / 10 m site tiles in dem_dir (finished .tif/.tiff files only)."""
    found = {p for pattern in DETAIL_PATTERNS for p in Path(dem_dir).glob(pattern)}
    return sorted(p for p in found if p.is_file() and p.suffix.lower() in (".tif", ".tiff"))


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

    def __init__(self, path: Path, center_lat: float, center_lon: float, radius_km: float = 160.0,
                 feather_m: float = 0.0):
        self.path = Path(path)
        self.feather_m = feather_m
        with rasterio.open(self.path) as src:
            self._check_crs(src.crs.to_dict())
            t = src.transform
            if t.b != 0 or t.d != 0:
                raise ValueError("Rotated map transforms are not supported.")
            cx, cy = polar_stereo_xy(center_lat, center_lon)
            r = radius_km * 1000.0
            b = src.bounds
            self.bounds = b  # the whole file's edges (for feathering), not just the window
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

    def sample(self, lat_deg, lon_deg):
        """(height, weight): weight 1 where the map has data, 0 where it has none.

        With feather_m > 0 the weight ramps from 0 to 1 over the last feather_m
        inside the file's edge (starting one pixel in, where bilinear data ends).
        """
        x, y = polar_stereo_xy(lat_deg, lon_deg)
        h = self.height_xy(x, y)
        w = (~np.isnan(h)).astype(float)
        if self.feather_m > 0:
            b = self.bounds
            edge = np.minimum(np.minimum(x - b.left, b.right - x),
                              np.minimum(y - b.bottom, b.top - y)) - self.resolution_m
            w *= np.clip(edge / self.feather_m, 0.0, 1.0)
        return h, w


class LayeredDEM:
    """Elevation maps stacked finest first; each fills in where the finer ones have no data.

    Layers are PolarDEMs or plain height functions (lat, lon) -> m, NaN = no data.
    A layer's weight (PolarDEM.sample) decides how much it contributes; the
    rest goes to the next layer. Weights are 0 or 1 except in the feather
    band at a site tile's edge, so the height there is a linear blend.
    """

    def __init__(self, layers):
        self.layers = list(layers)

    @property
    def detail(self) -> list:
        return self.layers[:-2]

    @property
    def near(self):
        return self.layers[-2]

    @property
    def far(self):
        return self.layers[-1]

    def __call__(self, lat_deg, lon_deg):
        lat, lon = np.broadcast_arrays(np.asarray(lat_deg, float), np.asarray(lon_deg, float))
        acc = np.zeros(lat.shape)
        rest = np.ones(lat.shape)  # weight still to be filled by coarser layers
        for layer in self.layers:
            need = rest > 0
            if not need.any():
                break
            h, w = _sample(layer, lat[need], lon[need])
            h = np.where(w > 0, h, 0.0)
            acc[need] += rest[need] * w * h
            rest[need] *= 1.0 - w
        got = 1.0 - rest
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(got > 0, acc / got, np.nan)


def _sample(layer, lat, lon):
    """(height, weight) from a PolarDEM, or from any plain height function (weight = has data)."""
    if hasattr(layer, "sample"):
        return layer.sample(lat, lon)
    h = np.asarray(layer(lat, lon), float)
    return h, (~np.isnan(h)).astype(float)


def _distance_to_bounds_m(x: float, y: float, b) -> float:
    dx = max(b.left - x, 0.0, x - b.right)
    dy = max(b.bottom - y, 0.0, y - b.top)
    return float(np.hypot(dx, dy))


def site_detail_tiles(lat: float, lon: float, reach_km: float = DETAIL_REACH_KM,
                      dem_dir: Path = DEM_DIR) -> list[Path]:
    """5 m / 10 m site tiles that come within reach_km of a site, nearest tile center first.

    Neighbouring sites' tiles can overlap; the site's own tile (centered on
    it) then comes first and wins. Unreadable files are skipped with a warning.
    """
    x, y = polar_stereo_xy(lat, lon)
    out = []
    for path in find_detail_tiles(dem_dir):
        try:
            with rasterio.open(path) as src:
                b = src.bounds
        except rasterio.errors.RasterioIOError as err:  # e.g. still downloading
            warnings.warn(f"skipping {path.name}: {err}")
            continue
        if _distance_to_bounds_m(x, y, b) <= reach_km * 1000.0:
            center = np.hypot((b.left + b.right) / 2 - x, (b.bottom + b.top) / 2 - y)
            out.append((float(center), path.name, path))
    return [path for _, _, path in sorted(out)]


def _ring_median(data: np.ndarray, k: int) -> np.ndarray:
    """Median of the 8 pixels k away (N, NE, E, ...) from each pixel; NaN near the edges."""
    h, w = data.shape
    pad = np.pad(data, k, constant_values=np.nan)
    ring = [pad[k + dy * k:k + dy * k + h, k + dx * k:k + dx * k + w]
            for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    return np.median(np.stack(ring), axis=0)  # NaN wherever the ring leaves the tile


def _grow(mask: np.ndarray) -> np.ndarray:
    """mask plus its 8 neighbours."""
    out = mask.copy()
    out[1:] |= mask[:-1]
    out[:-1] |= mask[1:]
    out[:, 1:] |= out[:, :-1].copy()
    out[:, :-1] |= out[:, 1:].copy()
    return out


def despike_tile(data: np.ndarray, ref: np.ndarray, res_m: float) -> np.ndarray:
    """Mask of bad-data spikes in a site tile, given the 20 m map's heights (ref) at its pixels.

    Cores: pixels more than SPIKE_M from both the median of their ring SPIKE_RING_M
    out and the 20 m map. Each core grows over the spike's flanks while the
    tile is still more than SPIKE_EDGE_M off the 20 m map (at most
    SPIKE_MAX_GROW_M), so swapping in the 20 m heights leaves no step.
    """
    dev = np.abs(data - ref)
    k = max(1, int(round(SPIKE_RING_M / res_m)))
    with np.errstate(invalid="ignore"):
        core = (np.abs(data - _ring_median(data, k)) > SPIKE_M) & (dev > SPIKE_M)
        off = dev > SPIKE_EDGE_M
    mask = core
    for _ in range(int(SPIKE_MAX_GROW_M / res_m)):
        grown = _grow(mask) & off
        grown |= mask
        if np.array_equal(grown, mask):
            break
        mask = grown
    return _grow(mask)  # one more pixel so bilinear reads at the edge use the 20 m map too


def _despike_with(tile: "PolarDEM", ref: "PolarDEM", verbose: bool) -> None:
    """Swap the 20 m map's heights into tile's bad-data spikes (in place)."""
    h, w = tile.data.shape
    xs = tile.x0 + (np.arange(w) + 0.5) * tile.dx
    ys = tile.y0 + (np.arange(h) + 0.5) * tile.dy
    ref_h = ref.height_xy(xs[None, :], ys[:, None]).astype(np.float32)
    bad = despike_tile(tile.data, ref_h, tile.resolution_m) & ~np.isnan(ref_h)
    tile.data[bad] = ref_h[bad]
    if verbose and bad.any():
        print(f"  {tile.path.name}: {int(bad.sum())} spike pixels "
              f"({bad.sum() * tile.resolution_m ** 2 / 1e6:.3f} km2) set to the 20 m map", flush=True)


FAR_RADIUS_KM = 260.0  # the 240 m map is small, so it is read out to the full ray length


def load_site_dem(lat: float, lon: float, radius_km: float = 160.0, verbose: bool = True,
                  dem_dir: Path = DEM_DIR, far_radius_km: float = FAR_RADIUS_KM) -> LayeredDEM:
    """5 m / 10 m site tiles (if any reach the site), then the 20 m and 240 m maps.

    The 20 m map is read within radius_km (about 1 GB at 160 km); beyond it
    the 240 m map takes over, out to far_radius_km.
    """
    detail = []
    for path in site_detail_tiles(lat, lon, dem_dir=dem_dir):
        # Read the whole tile (radius covers it) so feathering uses its true edges.
        detail.append(PolarDEM(path, lat, lon, radius_km=DETAIL_REACH_KM + 30.0,
                               feather_m=DETAIL_FEATHER_M))
    if verbose:
        names = ", ".join(d.path.name for d in detail) or "none (20 m map only)"
        print(f"  site tiles (5 m / 10 m) for ({lat}, {lon}): {names}", flush=True)
    near = PolarDEM(find_dem(NEAR_NAMES, dem_dir), lat, lon, radius_km)
    for tile in detail:
        _despike_with(tile, near, verbose)
    far = PolarDEM(find_dem(FAR_NAMES, dem_dir), lat, lon, max(radius_km, far_radius_km))
    return LayeredDEM([*detail, near, far])
