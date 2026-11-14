"""Horizon tests on made-up terrain (no map files needed), plus checks of the
map projection against the real files (skipped if they are not downloaded)."""

import numpy as np
import pytest

from lunar import dem as D
from lunar.ephemeris import site_frame
from lunar.horizon import horizon_mask, sample_distances_km, unit_vector

R = D.R_MOON_M
LAT, LON = -84.20156, 60.69989  # Nobile Rim 2
MAST = 3.0


def flat(lat, lon):
    return np.zeros(np.shape(lat))


def nearest_sample_km(d_km):
    s = sample_distances_km()
    return float(s[np.argmin(np.abs(s - d_km))])


def peak_direction(az_deg, dist_km, lat=LAT, lon=LON):
    """Unit vector of the surface point dist_km away at azimuth az_deg (site frame)."""
    east, north, up = site_frame(lat, lon)
    a = np.radians(az_deg)
    t = np.cos(a) * north + np.sin(a) * east
    ang = dist_km * 1000.0 / R
    return np.cos(ang) * up + np.sin(ang) * t


def cone(peak_dir, height_m, radius_m):
    """Height function for a cone of given height and base radius."""
    def h(lat, lon):
        v = unit_vector(lat, lon)
        dist = R * np.arccos(np.clip(v @ peak_dir, -1, 1))
        return height_m * np.clip(1 - dist / radius_m, 0, None)
    return h


def exact_elevation(peak_dir, height_m, ground_m=0.0):
    """Exact angle from the observer to the cone tip (independent of the walk)."""
    up = unit_vector(LAT, LON)
    obs = (R + ground_m + MAST) * up
    d = (R + height_m) * peak_dir - obs
    return np.degrees(np.arcsin(d @ up / np.linalg.norm(d)))


def sphere_dip_deg(h):
    return -np.degrees(np.arccos(R / (R + h)))


# ---- Spec tests -----------------------------------------------------------

def test_smooth_sphere_gives_geometric_dip():
    hz = horizon_mask(LAT, LON, flat, observer_height_m=MAST)
    expected = sphere_dip_deg(MAST)  # about -0.0586 deg for a 3 m mast
    np.testing.assert_allclose(hz.mask_deg, expected, atol=0.001)
    assert hz.ground_m == 0 and hz.skipped == 0


def test_cone_mountain_matches_exact_angle():
    dist = nearest_sample_km(4.0)  # put the tip exactly on a sample
    tip = peak_direction(0.0, dist)
    hz = horizon_mask(LAT, LON, cone(tip, 1000.0, 2000.0), observer_height_m=MAST)
    expected = exact_elevation(tip, 1000.0)
    assert hz.mask_deg[0] == pytest.approx(expected, abs=1e-6)
    # Small-angle version from the spec, for intuition: atan(dz/d) - d/(2R).
    small = np.degrees(np.arctan((1000.0 - MAST) / (dist * 1000)) - dist * 1000 / (2 * R))
    assert hz.mask_deg[0] == pytest.approx(small, abs=0.05)
    # Looking the other way there is no mountain: just the sphere dip.
    assert hz.mask_deg[180] == pytest.approx(sphere_dip_deg(MAST), abs=0.001)


# ---- Guards against likely bugs ------------------------------------------

@pytest.mark.parametrize("az", [0, 90, 180, 270])
def test_orientation_peak_shows_up_at_its_own_azimuth(az):
    # A peak due east must appear at mask[90], not mask[270] (mirror bug).
    tip = peak_direction(az, nearest_sample_km(3.0))
    hz = horizon_mask(LAT, LON, cone(tip, 500.0, 1000.0), observer_height_m=MAST)
    assert int(np.argmax(hz.mask_deg)) == az
    assert hz.mask_deg[(az + 180) % 360] < 0


def test_far_map_used_where_near_map_has_no_data():
    site = unit_vector(LAT, LON)

    def near(lat, lon):  # only covers 20 km around the site
        dist = R * np.arccos(np.clip(unit_vector(lat, lon) @ site, -1, 1))
        return np.where(dist < 20_000, 0.0, np.nan)

    far_tip = peak_direction(90.0, nearest_sample_km(60.0))
    far = cone(far_tip, 3000.0, 5000.0)
    hz = horizon_mask(LAT, LON, D.TwoLevelDEM(near, far), observer_height_m=MAST)
    assert int(np.argmax(hz.mask_deg)) == 90
    assert hz.mask_deg[90] == pytest.approx(exact_elevation(far_tip, 3000.0), abs=1e-6)


def test_near_map_wins_over_far_map():
    near_tip = peak_direction(45.0, nearest_sample_km(2.0))
    hz = horizon_mask(LAT, LON, D.TwoLevelDEM(cone(near_tip, 300.0, 800.0), flat),
                      observer_height_m=MAST)
    assert int(np.argmax(hz.mask_deg)) == 45


def test_missing_data_is_skipped_not_zero():
    def holey(lat, lon):
        h = np.full(np.shape(lat), -500.0)  # everything 500 m below the observer
        h[..., 100:] = np.nan  # holes far out
        return h if np.ndim(lat) == 2 else np.zeros(np.shape(lat))

    hz = horizon_mask(LAT, LON, holey, observer_height_m=MAST)
    assert hz.skipped > 0
    # If the holes were treated as 0 m, the horizon would be about -0.1 deg
    # (flat ground 5 km away). Skipped properly, only the -500 m terrain counts.
    assert (hz.mask_deg < -1.0).all()


# ---- Projection checks against the real map files ---------------------------

def _real_dem_path(names):
    try:
        return D.find_dem(names)
    except FileNotFoundError as err:
        pytest.skip(str(err))


@pytest.mark.parametrize("names", [D.NEAR_NAMES, D.FAR_NAMES])
def test_projection_matches_rasterio(names):
    import rasterio
    from rasterio.warp import transform

    with rasterio.open(_real_dem_path(names)) as src:
        crs = src.crs
    lats = [-84.20156, -80.0, -89.0, -86.0]
    lons = [0.0, 60.69989, 135.0, 270.0]
    xs, ys = transform("+proj=longlat +R=1737400 +no_defs", crs, lons, lats)
    ours = D.polar_stereo_xy(np.array(lats), np.array(lons))
    np.testing.assert_allclose(ours[0], xs, atol=0.01)
    np.testing.assert_allclose(ours[1], ys, atol=0.01)
    lat_back, lon_back = D.polar_stereo_latlon(*ours)
    np.testing.assert_allclose(lat_back, lats, atol=1e-9)
    np.testing.assert_allclose(lon_back, np.array(lons) % 360, atol=1e-9)


def test_dem_returns_raw_pixel_value_at_pixel_center():
    near = D.PolarDEM(_real_dem_path(D.NEAR_NAMES), LAT, LON, radius_km=2)
    row, col = 37, 41
    x = near.x0 + (col + 0.5) * near.dx
    y = near.y0 + (row + 0.5) * near.dy
    assert near.height_xy(x, y) == pytest.approx(near.data[row, col], abs=1e-3)
    lat, lon = D.polar_stereo_latlon(x, y)
    assert near(lat, lon) == pytest.approx(near.data[row, col], abs=1e-3)
