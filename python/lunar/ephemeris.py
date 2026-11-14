"""Sun and Earth direction vectors in a site frame.

For every time sample we compute where the Sun and Earth are as seen from the
site, as unit vectors in a local (east, north, up) frame:

  e = how far the direction points east
  n = how far it points north ("grid north" of the site frame)
  u = how far it points up

Azimuth is measured clockwise from north toward east; elevation is the angle
above the flat plane perpendicular to "up". No atmosphere, so no refraction.

Libration (the Moon's slow wobble as seen from Earth) is not modelled by hand:
it comes from the lunar orientation kernel (moon_pa_de440_*.bpc), which gives
the Moon's exact orientation at every instant.
"""

from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import spiceypy as spice

MOON_RADIUS_KM = 1737.4  # LOLA reference sphere (same as JPL Horizons uses)
AU_KM = 149_597_870.7
FRAME = "MOON_ME"  # mean Earth / polar axis body-fixed frame
ABCORR = "LT+S"  # light time + stellar aberration

KERNEL_FILES = [
    "naif0012.tls",  # leap seconds (UTC <-> TDB)
    "pck00011.tpc",  # generic body constants
    "de440s.bsp",  # planet and Moon positions
    "moon_pa_de440_200625.bpc",  # Moon orientation (includes libration)
    "moon_de440_250416.tf",  # defines the MOON_ME frame
]

DEFAULT_KERNEL_DIR = Path(__file__).resolve().parents[1] / "data" / "kernels"


def load_kernels(kernel_dir: Path = DEFAULT_KERNEL_DIR) -> None:
    """Load the SPICE kernels. Safe to call more than once."""
    kernel_dir = Path(kernel_dir)
    missing = [f for f in KERNEL_FILES if not (kernel_dir / f).exists()]
    if missing:
        raise FileNotFoundError(
            f"Missing kernels in {kernel_dir}: {missing}. Run python/scripts/fetch_data.sh kernels"
        )
    spice.kclear()
    for name in KERNEL_FILES:
        spice.furnsh(str(kernel_dir / name))


def site_position_km(lat_deg: float, lon_deg: float, height_m: float = 3.0,
                     ground_m: float = 0.0) -> np.ndarray:
    """Site position from the Moon's center, in MOON_ME, in km.

    ground_m: LOLA terrain height at the site (relative to the 1737.4 km sphere).
    height_m: mast height above the ground.
    """
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    r = MOON_RADIUS_KM + (ground_m + height_m) / 1000.0
    return r * np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def site_frame(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit vectors (east, north, up) of the local frame at a site, in MOON_ME."""
    if abs(abs(lat_deg) - 90.0) < 1e-6:
        raise ValueError("East/north are undefined exactly at a pole; use a point slightly off it.")
    up = site_position_km(lat_deg, lon_deg, 0.0)
    up = up / np.linalg.norm(up)
    east = np.cross([0.0, 0.0, 1.0], up)
    east = east / np.linalg.norm(east)
    north = np.cross(up, east)
    return east, north, up


def hourly_ets(start_utc: str, count: int, step_hours: float = 1.0) -> np.ndarray:
    """Ephemeris times (TDB seconds) for count UTC samples, step_hours apart.

    Each UTC instant is converted on its own, so leap seconds are respected.
    """
    t0 = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
    step = timedelta(hours=step_hours)
    return np.array([
        spice.str2et((t0 + k * step).strftime("%Y-%m-%d %H:%M:%S") + " UTC")
        for k in range(count)
    ])


def body_enu(target: str, ets: np.ndarray, site_pos_km: np.ndarray,
             frame_vecs: tuple[np.ndarray, np.ndarray, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Direction to a body as seen from the site.

    Returns (enu, dist_km): enu has shape (N, 3) with unit vectors (e, n, u),
    dist_km has shape (N,).
    """
    pos_from_moon, _ = spice.spkpos(target, ets, FRAME, ABCORR, "MOON")
    topo = np.asarray(pos_from_moon) - site_pos_km  # from the site, not the Moon's center
    dist = np.linalg.norm(topo, axis=1)
    east, north, up = frame_vecs
    enu = np.stack([topo @ east, topo @ north, topo @ up], axis=1) / dist[:, None]
    return enu, dist


def az_el(e, n, u):
    """Azimuth (deg, clockwise from north toward east, 0..360) and elevation (deg)."""
    e, n, u = np.asarray(e), np.asarray(n), np.asarray(u)
    az = np.degrees(np.arctan2(e, n)) % 360.0
    el = np.degrees(np.arcsin(u / np.sqrt(e * e + n * n + u * u)))
    return az, el


def site_ephemeris(lat_deg: float, lon_deg: float, start_utc: str, count: int,
                   step_hours: float = 1.0, height_m: float = 3.0,
                   ground_m: float = 0.0) -> dict:
    """Sun and Earth unit vectors (site frame), Sun distance in AU, Earth distance in km."""
    ets = hourly_ets(start_utc, count, step_hours)
    pos = site_position_km(lat_deg, lon_deg, height_m, ground_m)
    frame = site_frame(lat_deg, lon_deg)
    sun, sun_dist = body_enu("SUN", ets, pos, frame)
    earth, earth_dist = body_enu("EARTH", ets, pos, frame)
    return {
        "sun": {"e": sun[:, 0], "n": sun[:, 1], "u": sun[:, 2], "r_au": sun_dist / AU_KM},
        "earth": {"e": earth[:, 0], "n": earth[:, 1], "u": earth[:, 2], "r_km": earth_dist},
    }
