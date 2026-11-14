"""Grid points around a site: positions, up tilt, and Sun/Earth vectors seen from a point."""

import numpy as np
import pytest

from lunar.dem import R_MOON_M as R
from lunar.ephemeris import az_el, site_frame
from lunar.grid import grid_offsets, point_axes, point_latlon, point_up, point_vectors, to_point_frame, up_tilt
from lunar.horizon import horizon_mask, unit_vector
from lunar.metrics import mask_at

LAT, LON = -86.80402, -21.66710  # Haworth
FRAME = site_frame(LAT, LON)
MAST = 3.0


def flat(lat, lon):
    return np.zeros(np.shape(lat))


def test_offsets_cover_11_by_11_with_one_center():
    offs = grid_offsets()
    assert len(offs) == 121
    assert sorted({i for i, *_ in offs}) == list(range(-5, 6))
    assert sorted({j for _, j, *_ in offs}) == list(range(-5, 6))
    assert [o for o in offs if o[2] == 0 and o[3] == 0] == [(0, 0, 0.0, 0.0)]
    assert offs[0] == (-5, -5, -5.0, -5.0)  # south-west corner first, then eastward
    assert offs[1] == (-4, -5, -4.0, -5.0)


def test_center_is_the_site_with_no_tilt():
    lat, lon = point_latlon(0, 0, FRAME, 0.0)
    assert lat == pytest.approx(LAT, abs=1e-9)
    assert lon == pytest.approx(LON, abs=1e-9)
    assert up_tilt(point_up(0, 0, FRAME, 0.0), FRAME) == pytest.approx((0.0, 0.0), abs=1e-12)


def test_one_km_east_is_one_km_due_east():
    up_p = point_up(1000.0, 0.0, FRAME, 0.0)
    east, north, up = FRAME
    dist_m = R * np.arccos(up_p @ up)
    assert dist_m == pytest.approx(1000.0, abs=0.01)
    step = up_p - up
    assert step @ north == pytest.approx(0.0, abs=1e-12)
    assert step @ east > 0
    te, tn = up_tilt(up_p, FRAME)
    assert te == pytest.approx(1000.0 / R, rel=1e-6)  # ~0.033 deg per km
    assert tn == pytest.approx(0.0, abs=1e-12)


def test_rotation_is_identity_at_zero_tilt():
    v = np.array([[0.3, -0.5, 0.1], [0.0, 0.0, 1.0]])
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    e, n, u = to_point_frame(v[:, 0], v[:, 1], v[:, 2], (0.0, 0.0))
    np.testing.assert_allclose(np.stack([e, n, u], axis=1), v, atol=1e-15)


@pytest.mark.parametrize("tilt", [(0.002, -0.0015), (-0.0029, 0.0029), (0.0, 0.0029)])
def test_point_axes_orthonormal_and_unit_length_kept(tilt):
    east, north, up = point_axes(tilt)
    m = np.stack([east, north, up])
    np.testing.assert_allclose(m @ m.T, np.eye(3), atol=1e-15)
    np.testing.assert_allclose(np.cross(east, north), up, atol=1e-15)  # right-handed
    rng = np.random.default_rng(1)
    v = rng.normal(size=(50, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    e, n, u = to_point_frame(v[:, 0], v[:, 1], v[:, 2], tilt)
    np.testing.assert_allclose(np.sqrt(e * e + n * n + u * u), 1.0, atol=1e-14)


def test_center_zenith_seen_from_5_km_east_leans_west():
    tilt = up_tilt(point_up(5000.0, 0.0, FRAME, 0.0), FRAME)
    az, el = az_el(*to_point_frame([0.0], [0.0], [1.0], tilt))
    assert el[0] == pytest.approx(90.0 - np.degrees(5000.0 / R), abs=1e-6)
    assert az[0] == pytest.approx(270.0, abs=1e-6)


def test_point_vectors_keeps_other_fields():
    v = {"e": [0.0], "n": [1.0], "u": [0.0], "r_au": [1.0]}
    out = point_vectors(v, (0.001, 0.0))
    assert out["r_au"] == [1.0]
    assert v["e"] == [0.0]  # input untouched


def test_off_center_smooth_sphere_gives_geometric_dip():
    lat, lon = point_latlon(4000.0, -3000.0, FRAME, 0.0)
    hz = horizon_mask(lat, lon, flat, frame=FRAME, observer_height_m=MAST)
    np.testing.assert_allclose(hz.mask_deg, -np.degrees(np.arccos(R / (R + MAST))), atol=0.001)


def test_peak_seen_from_a_grid_point_lines_up_with_rotated_vector():
    """A mountain seen from an off-center point: its mask peak (horizon_mask,
    site-frame azimuths) must sit where the exact direction to the summit,
    rotated with to_point_frame, says it is."""
    dx, dy = 4000.0, 3000.0
    lat, lon = point_latlon(dx, dy, FRAME, 0.0)
    up_o = unit_vector(lat, lon)
    tilt = up_tilt(point_up(dx, dy, FRAME, 0.0), FRAME)

    # A broad cone 15 km from the site center, roughly south-west of the point.
    east, north, up = FRAME
    q = R * up - 9000.0 * east - 12000.0 * north
    tip_dir = q / np.linalg.norm(q)
    height, radius = 700.0, 4000.0

    def cone(la, lo):
        v = unit_vector(la, lo)
        d = R * np.arccos(np.clip(v @ tip_dir, -1, 1))
        return height * np.clip(1 - d / radius, 0, None)

    hz = horizon_mask(lat, lon, cone, frame=FRAME, observer_height_m=MAST)

    obs = (R + MAST) * up_o
    to_tip = (R + height) * tip_dir - obs
    to_tip /= np.linalg.norm(to_tip)
    site_enu = [to_tip @ east, to_tip @ north, to_tip @ up]
    az, el = az_el(*to_point_frame(*([x] for x in site_enu), tilt))

    peak_az = int(np.argmax(hz.mask_deg))
    assert abs((peak_az - az[0] + 180) % 360 - 180) <= 1.0
    # The tip falls between 1-deg mask samples and the cone's top is sharp
    # (~0.15 deg of elevation per deg of azimuth here), so interpolation sits a bit low.
    assert float(mask_at(hz.mask_deg, az[0])) == pytest.approx(el[0], abs=0.1)
    assert hz.mask_deg.max() <= el[0] + 0.005  # the summit is the highest thing there
