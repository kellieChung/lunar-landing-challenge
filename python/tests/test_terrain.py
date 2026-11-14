"""Near-field heightmap (3D view only) on made-up terrain."""

import numpy as np
import pytest

from lunar import dem as D
from lunar.ephemeris import site_frame
from lunar.horizon import horizon_mask, unit_vector
from lunar.terrain import terrain_grid

R = D.R_MOON_M
LAT, LON = -84.20156, 60.69989  # Nobile Rim 2
MAST = 3.0


def flat(lat, lon):
    return np.zeros(np.shape(lat))


def surface_direction(x_m, y_m, lat=LAT, lon=LON, ground_m=0.0):
    """Where the heightmap vertex (x east, y north) lands on the sphere."""
    east, north, up = site_frame(lat, lon)
    q = (R + ground_m) * up + x_m * east + y_m * north
    return q / np.linalg.norm(q)


def cone_at(peak_dir, height_m, radius_m):
    def h(lat, lon):
        dist = R * np.arccos(np.clip(unit_vector(lat, lon) @ peak_dir, -1, 1))
        return height_m * np.clip(1 - dist / radius_m, 0, None)
    return h


def test_flat_sphere_gives_curvature_drop():
    t = terrain_grid(LAT, LON, flat)
    assert t.heights_m.shape == (101, 101) and t.heights_m.dtype == np.float32
    assert t.x0_m == -5000 and t.y0_m == -5000 and t.spacing_m == 100
    coords = -5000 + 100 * np.arange(101)
    x, y = np.meshgrid(coords, coords)
    d2 = x * x + y * y
    exact = R * R / np.sqrt(R * R + d2) - R
    np.testing.assert_allclose(t.heights_m, exact, rtol=1e-5, atol=1e-3)
    np.testing.assert_allclose(t.heights_m, -d2 / (2 * R), atol=1e-3)
    assert t.heights_m[50, 50] == 0.0
    assert t.heights_m[50, 100] == pytest.approx(-7.2, abs=0.05)  # 5 km east


@pytest.mark.parametrize("x_m, y_m, row, col", [(2000, 0, 50, 70), (0, 2000, 70, 50), (-3000, -1000, 40, 20)])
def test_orientation_peak_lands_on_its_own_vertex(x_m, y_m, row, col):
    # Rows go south->north (y), columns west->east (x): guards against mirror bugs.
    tip = surface_direction(x_m, y_m)
    t = terrain_grid(LAT, LON, cone_at(tip, 400.0, 600.0))
    assert np.unravel_index(np.argmax(t.heights_m), t.heights_m.shape) == (row, col)
    expected = (R + 400.0) * (tip @ unit_vector(LAT, LON)) - R
    assert t.heights_m[row, col] == pytest.approx(expected, abs=0.01)


def test_heights_relative_to_observer_ground():
    def raised(lat, lon):
        return np.full(np.shape(lat), 1122.0)
    t = terrain_grid(LAT, LON, raised)
    assert t.ground_m == 1122.0
    assert t.heights_m[50, 50] == pytest.approx(0.0, abs=1e-6)
    assert t.header("x.bin")["ground_m"] == 1122.0


def test_heightmap_agrees_with_horizon_mask():
    # A cone 3 km due north: the steepest heightmap vertex in that direction
    # must match the 0-5 km horizon band (same geometry, independent code).
    tip = surface_direction(0, 3000)
    hfn = cone_at(tip, 600.0, 1000.0)
    t = terrain_grid(LAT, LON, hfn)
    hz = horizon_mask(LAT, LON, hfn, frame=site_frame(LAT, LON), observer_height_m=MAST)
    col = t.heights_m[51:, 50].astype(float)  # x = 0, y = 100 m .. 5 km
    d = 100.0 * np.arange(1, 51)
    steepest = np.degrees(np.arctan2(col - MAST, d)).max()
    # Not exact: a vertex is drawn at (x, y) but the terrain point sits
    # |y| |h - g| / R further out (~1 m here), about 0.004 deg at this angle.
    assert steepest == pytest.approx(hz.bands_deg[0][0], abs=0.01)


def test_missing_data_raises():
    def holey(lat, lon):
        h = np.zeros(np.shape(lat))
        if h.ndim == 2:
            h[0, 0] = np.nan
        return h
    with pytest.raises(ValueError):
        terrain_grid(LAT, LON, holey)


def test_header_describes_grid():
    h = terrain_grid(LAT, LON, flat).header("nobile-rim-2_terrain.bin")
    assert h["nx"] == h["ny"] == 101 and h["format"] == "float32-le"
    assert h["file"] == "nobile-rim-2_terrain.bin"
