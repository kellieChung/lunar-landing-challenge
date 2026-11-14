"""The 11 x 11 grid of observer points around a site center.

All points share the site-center frame (east, north, up) for azimuth, so
"azimuth 90" means the same direction everywhere in the grid. Each point
sits on the site's tangent plane at (dx east, dy north) and is projected
straight down to the Moon, the same mapping lunar/terrain.py uses for the
heightmap vertices, so grid points, heightmap and masks all line up:

    q   = (R + g) up + dx east + dy north
    dir = q / |q|                                 the point's own "up"

A point's own up is tilted from the site's up by about 0.033 deg per km
(dx / R radians). The Sun/Earth vectors in the site file are computed once at
the site center; to judge "is the Sun above the horizon" at a grid point we
measure them against that point's own up (to_point_frame). Moving the
observer a few km changes the direction to the Sun or Earth by at most
7 km / 384,400 km ~ 0.001 deg (Earth), which we ignore.
"""

import math

import numpy as np

from lunar.dem import R_MOON_M

GRID_SIZE = 11  # points per side
GRID_SPACING_KM = 1.0


def grid_offsets(size: int = GRID_SIZE, spacing_km: float = GRID_SPACING_KM) -> list[tuple[int, int, float, float]]:
    """(i, j, dx_km, dy_km) for every point: i counts east, j counts north, 0 = center.

    Ordered south to north (j), then west to east (i).
    """
    half = size // 2
    return [(i, j, i * spacing_km, j * spacing_km)
            for j in range(-half, half + 1) for i in range(-half, half + 1)]


def point_up(dx_m: float, dy_m: float, frame, ground_m: float, radius_m: float = R_MOON_M) -> np.ndarray:
    """Unit vector (MOON_ME) from the Moon's center through the grid point."""
    east, north, up = frame
    q = (radius_m + ground_m) * up + dx_m * east + dy_m * north
    return q / np.linalg.norm(q)


def point_latlon(dx_m: float, dy_m: float, frame, ground_m: float,
                 radius_m: float = R_MOON_M) -> tuple[float, float]:
    """Latitude, longitude (deg, east -180..180) of a grid point."""
    d = point_up(dx_m, dy_m, frame, ground_m, radius_m)
    return float(np.degrees(np.arcsin(d[2]))), float(np.degrees(np.arctan2(d[1], d[0])))


def up_tilt(up_p: np.ndarray, frame) -> tuple[float, float]:
    """The point's up expressed in the site frame: (east part, north part)."""
    east, north, _ = frame
    return float(up_p @ east), float(up_p @ north)


def point_axes(tilt) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Orthonormal (east, north, up) of a grid point, written in the site frame.

    tilt = (te, tn): the point's up in the site frame (up_tilt). east_p is the
    site's east with its small up_p part removed, north_p = up_p x east_p.
    This is how horizon_mask measures azimuth at the point (site north/east
    flattened onto the point's horizontal plane), to within tilt^2 (~1e-5 rad
    at 7 km), far below the 1 deg mask step.
    """
    te, tn = float(tilt[0]), float(tilt[1])
    up = (te, tn, math.sqrt(1.0 - te * te - tn * tn))
    # Spelled out (no np.linalg.norm / np.cross) so web/src/physics/grid.ts
    # computes bit-identical axes.
    raw = (1.0 - te * up[0], -te * up[1], -te * up[2])  # site east minus its up part
    length = math.sqrt(raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2])
    east = (raw[0] / length, raw[1] / length, raw[2] / length)
    north = (up[1] * east[2] - up[2] * east[1],
             up[2] * east[0] - up[0] * east[2],
             up[0] * east[1] - up[1] * east[0])
    return np.array(east), np.array(north), np.array(up)


def to_point_frame(e, n, u, tilt):
    """Rotate site-frame direction(s) into a grid point's own (east, north, up).

    An exact rotation: unit vectors stay unit vectors, the new u is the true
    elevation sine at the point, and tilt (0, 0) changes nothing.
    """
    e, n, u = (np.asarray(x, float) for x in (e, n, u))
    # Written out term by term (not a matrix product) so the TypeScript port
    # (web/src/physics/grid.ts) adds the same numbers in the same order.
    dot = lambda a: e * a[0] + n * a[1] + u * a[2]
    east, north, up = point_axes(tilt)
    return dot(east), dot(north), dot(up)


def point_vectors(v: dict, tilt) -> dict:
    """A copy of a site-file vector dict ({"e","n","u", ...}) seen from a grid point."""
    e, n, u = to_point_frame(v["e"], v["n"], v["u"], tilt)
    return {**v, "e": e, "n": n, "u": u}
