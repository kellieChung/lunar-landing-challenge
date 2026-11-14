"""Horizon masks: how high the surrounding terrain reaches in each direction.

For one observer point and each of 360 azimuths (1 deg steps, in the site
frame), walk outward along the surface from 0.1 km to 150 km, look up the
terrain height, and keep the largest elevation angle. That angle is the
horizon in that direction: the Sun or Earth is hidden when it is lower.

Exact 3D form (includes the Moon's curvature automatically):

    elevation = asin( dot(P - O, up_O) / |P - O| )

O = observer position (ground + mast height), P = terrain point, both as
vectors from the Moon's center; up_O = O / |O|.
"""

from dataclasses import dataclass

import numpy as np

from lunar.dem import R_MOON_M
from lunar.ephemeris import site_frame

NEAR_START_KM = 0.1
NEAR_STEP_KM = 0.05  # fine steps close to the observer
NEAR_LIMIT_KM = 5.0
FAR_GROWTH = 0.01  # beyond 5 km each step is 1% of the distance
MAX_KM = 150.0


def sample_distances_km(max_km: float = MAX_KM) -> np.ndarray:
    """Distances along each azimuth where terrain is sampled."""
    n_near = int(round((NEAR_LIMIT_KM - NEAR_START_KM) / NEAR_STEP_KM)) + 1
    near = NEAR_START_KM + NEAR_STEP_KM * np.arange(n_near)  # 0.10, 0.15, ... 5.00
    far = []
    d = NEAR_LIMIT_KM
    while d < max_km:
        d = min(d * (1 + FAR_GROWTH), max_km)
        far.append(d)
    return np.concatenate([near, far])


def unit_vector(lat_deg, lon_deg) -> np.ndarray:
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


@dataclass
class Horizon:
    mask_deg: np.ndarray  # (360,) horizon elevation per degree of azimuth
    ground_m: float  # terrain height at the observer (relative to the datum sphere)
    skipped: int  # samples with no terrain data in any map (ignored, never set to 0)


def horizon_mask(lat_deg: float, lon_deg: float, height_fn, frame=None,
                 observer_height_m: float = 3.0, max_km: float = MAX_KM,
                 radius_m: float = R_MOON_M) -> Horizon:
    """Horizon mask for one observer point.

    height_fn(lat, lon) -> terrain height in metres (vectorized; NaN = no data).
    frame: (east, north, up) of the site frame. Azimuths are measured in this
           frame ("grid north"); defaults to the observer's own local frame.
    """
    east, north, _ = frame if frame is not None else site_frame(lat_deg, lon_deg)
    up_o = unit_vector(lat_deg, lon_deg)
    ground = float(height_fn(np.array([lat_deg]), np.array([lon_deg]))[0])
    if np.isnan(ground):
        raise ValueError(f"No terrain data at the observer ({lat_deg}, {lon_deg}).")
    obs = (radius_m + ground + observer_height_m) * up_o

    # Start directions for each azimuth, flattened into the observer's horizontal plane.
    az = np.radians(np.arange(360.0))
    t = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east  # (360, 3)
    t -= (t @ up_o)[:, None] * up_o
    t /= np.linalg.norm(t, axis=1, keepdims=True)

    # Walk along great circles: point direction at surface distance s.
    ang = sample_distances_km(max_km) * 1000.0 / radius_m  # (N,) radians
    dirs = (np.cos(ang)[None, :, None] * up_o
            + np.sin(ang)[None, :, None] * t[:, None, :])  # (360, N, 3)
    lat_s = np.degrees(np.arcsin(np.clip(dirs[..., 2], -1, 1)))
    lon_s = np.degrees(np.arctan2(dirs[..., 1], dirs[..., 0]))
    h = np.asarray(height_fn(lat_s, lon_s), float)  # (360, N)

    terrain = (radius_m + h)[..., None] * dirs
    d = terrain - obs
    el = np.degrees(np.arcsin((d @ up_o) / np.linalg.norm(d, axis=-1)))

    skipped = int(np.isnan(el).sum())
    if np.isnan(el).all(axis=1).any():
        raise ValueError("Some azimuths have no terrain data at all.")
    return Horizon(mask_deg=np.nanmax(el, axis=1), ground_m=ground, skipped=skipped)
