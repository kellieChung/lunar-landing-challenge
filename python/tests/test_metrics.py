"""Metrics tests: made-up cases with known answers, plus the Python <-> TypeScript fixture."""

import json
import math
from pathlib import Path

import numpy as np
import pytest

from lunar import metrics as M
from lunar.grid import point_vectors

FIXTURE = Path(__file__).parent / "fixtures" / "metrics_parity.json"
FLAT = [0.0] * 360


def enu(az_deg, el_deg):
    a, e = np.radians(az_deg), np.radians(el_deg)
    return np.cos(e) * np.sin(a), np.cos(e) * np.cos(a), np.sin(e)


# ---- mask_at ----------------------------------------------------------------

def test_mask_at_interpolates_and_wraps():
    mask = [0.0] * 360
    mask[359], mask[0], mask[10] = 2.0, 4.0, 1.0
    assert M.mask_at(mask, 0) == 4.0
    assert M.mask_at(mask, 359.5) == pytest.approx(3.0)  # between 359 and 0
    assert M.mask_at(mask, -0.5) == pytest.approx(3.0)
    assert M.mask_at(mask, 360) == 4.0
    assert M.mask_at(mask, 9.75) == pytest.approx(0.75)


# ---- Sunlit fraction ----------------------------------------------------------

def test_disk_fully_above_and_below():
    assert M.sunlit_fraction(*enu(100, 2.0), 1.0, FLAT) == 1.0
    assert M.sunlit_fraction(*enu(100, -2.0), 1.0, FLAT) == 0.0


def test_disk_cut_by_a_flat_horizon():
    # Horizon exactly through the center: only the 3 upper ring points are
    # strictly above. Just above the center: center + 3 upper + 2 side points.
    mask = [1.0] * 360
    assert M.sunlit_fraction(*enu(100, 1.0), 1.0, mask) == pytest.approx(3 / 9)
    assert M.sunlit_fraction(*enu(100, 1.001), 1.0, mask) == pytest.approx(6 / 9)


def test_fraction_ge_half_means_center_above_for_flat_horizon():
    mask = [0.5] * 360
    for el in np.linspace(0.0, 1.0, 101):
        lit = M.sunlit_fraction(*enu(200, el), 1.0, mask) >= M.LIT_THRESHOLD
        assert lit == (el > 0.5)


def test_sun_radius_at_1_au():
    assert M.sun_radius_deg(1.0) == pytest.approx(0.2666, abs=1e-3)  # ~0.53 deg wide


# ---- Flux -------------------------------------------------------------------

def test_flux_panel_factors():
    f = M.flux_w_m2(1.0, 1.0, 30.0)
    assert f["tracking"] == pytest.approx(M.SOLAR_CONSTANT_W_M2)
    assert f["vertical"] == pytest.approx(M.SOLAR_CONSTANT_W_M2 * math.cos(math.radians(30)))
    assert f["horizontal"] == pytest.approx(M.SOLAR_CONSTANT_W_M2 * 0.5)
    assert M.flux_w_m2(1.0, 1.0, -1.0)["horizontal"] == 0.0  # Sun below the panel's plane
    assert M.flux_w_m2(2.0, 0.5, 0.0)["tracking"] == pytest.approx(M.SOLAR_CONSTANT_W_M2 / 8)


# ---- Windows ----------------------------------------------------------------

def fake_series(lit, earth):
    lit, earth = np.array(lit, bool), np.array(earth, bool)
    return {"lit": lit, "earth": earth, "fraction": lit.astype(float),
            "sun_el": np.zeros(len(lit)), "r_au": np.ones(len(lit)), "earth_margin": earth - 0.5}


def test_longest_run():
    assert M.longest_run([]) == 0
    assert M.longest_run([True, True, False, True, True, True, False]) == 3


def test_window_metrics_counts_and_clips():
    s = fake_series(lit=[1, 1, 0, 0, 0, 1, 0, 0], earth=[0, 1, 1, 1, 0, 0, 0, 1])
    m = M.window_metrics(s, 0, 8, step_hours=2.0)
    assert m["samples"] == 8
    assert m["sunlit_pct"] == pytest.approx(37.5)
    assert m["earth_pct"] == pytest.approx(50.0)
    assert m["both_pct"] == pytest.approx(12.5)  # only sample 1
    assert m["longest_dark_h"] == 6.0  # 3 samples x 2 h
    assert m["longest_blackout_h"] == 6.0
    # A window starting mid-night only counts the part inside it.
    assert M.window_metrics(s, 3, 3)["longest_dark_h"] == 2.0


# ---- Interpolation and events -----------------------------------------------

def test_vector_at_is_normalized_and_exact_on_samples():
    v = {"e": [1.0, 0.0], "n": [0.0, 1.0], "u": [0.0, 0.0]}
    assert M.vector_at(v, 0) == pytest.approx((1, 0, 0))
    assert M.vector_at(v, 1) == pytest.approx((0, 1, 0))
    assert np.linalg.norm(M.vector_at(v, 0.5)) == pytest.approx(1.0)


def test_sunrise_time_on_a_steady_climb():
    # Sun climbing 0.1 deg per sample from -1 deg over a flat 0 deg horizon.
    # Lit when the center is above 0 deg; with linear vector interpolation
    # that is (almost exactly) t = 10.
    els = -1.0 + 0.1 * np.arange(30)
    e, n, u = enu(90.0, els)
    sun = {"e": e, "n": n, "u": u, "r_au": np.ones(30)}
    s = M.site_series(sun, sun, FLAT)
    lit_at = lambda t: M.sun_lit_at(sun, FLAT, t)
    rise = M.next_change(lit_at, s["lit"], 0.0, True)
    assert rise == pytest.approx(10.0, abs=1e-3)
    assert lit_at(rise) and not lit_at(rise - 1e-6)
    assert M.next_change(lit_at, s["lit"], 0.0, False) is None  # never sets again
    assert M.next_change(lit_at, s["lit"], rise, True) is None  # repeat press: no later sunrise


def test_events_alternate_from_an_event_time():
    case = json.loads(FIXTURE.read_text())["cases"][0]
    s = M.site_series(case["sun"], case["earth"], case["mask"])
    lit_at = lambda t: M.sun_lit_at(case["sun"], case["mask"], t)
    rise = M.next_change(lit_at, s["lit"], 0, True)
    sset = M.next_change(lit_at, s["lit"], rise, False)
    rise2 = M.next_change(lit_at, s["lit"], rise, True)
    assert rise < sset < rise2  # pressing "next sunrise" twice moves on


# ---- Shared fixture (the TypeScript test checks the same numbers) -----------

def fixture_cases():
    return json.loads(FIXTURE.read_text())["cases"]


@pytest.mark.parametrize("case", fixture_cases(), ids=lambda c: c["name"])
def test_parity_fixture(case):
    mask, exp = case["mask"], case["expected"]
    sun, earth = case["sun"], case["earth"]
    if "tilt" in case:  # an off-center grid point: see the vectors from there first
        sun, earth = point_vectors(sun, case["tilt"]), point_vectors(earth, case["tilt"])
    s = M.site_series(sun, earth, mask)
    np.testing.assert_allclose(s["fraction"], exp["fraction"], atol=1e-12)
    np.testing.assert_allclose(s["eclipse"], exp["eclipse"], atol=1e-12)
    np.testing.assert_allclose(s["earth_margin"], exp["earth_margin"], atol=1e-9)
    for (a, n), want in zip(case["windows"], exp["windows"]):
        got = M.window_metrics(s, a, n, case["step_hours"])
        assert got["samples"] == want["samples"]
        assert got["longest_dark_h"] == want["longest_dark_h"]
        assert got["longest_blackout_h"] == want["longest_blackout_h"]
        for k in ("sunlit_pct", "mean_sunlit_fraction", "earth_pct", "both_pct"):
            assert got[k] == pytest.approx(want[k], abs=1e-9)
        for k, v in want["mean_flux_w_m2"].items():
            assert got["mean_flux_w_m2"][k] == pytest.approx(v, abs=1e-6)
    lit_at = lambda t: M.sun_lit_at(sun, mask, t)
    earth_at = lambda t: M.earth_visible_at(earth, mask, t)
    for (t, body, to), want in zip(case["events"], exp["events"]):
        state_at, hourly = (lit_at, s["lit"]) if body == "sun" else (earth_at, s["earth"])
        got = M.next_change(state_at, hourly, t, to)
        assert (got is None) == (want is None)
        if want is not None:
            assert got == pytest.approx(want, abs=1e-6)


# ---- Eclipses of the Sun by Earth ---------------------------------------------

def _pair(sep_deg, r_au=1.0, r_km=384_400.0):
    """Sun at azimuth 100, Earth sep_deg to its right, both at 3 deg elevation."""
    e1, n1, u1 = enu(100.0, 3.0)
    e2, n2, u2 = enu(100.0 + sep_deg / math.cos(math.radians(3.0)), 3.0)
    return ({"e": [e1], "n": [n1], "u": [u1], "r_au": [r_au]},
            {"e": [e2], "n": [n2], "u": [u2], "r_km": [r_km]})


def test_eclipse_share_limits():
    assert M.eclipse_share(*_pair(5.0))[0] == 1.0  # far apart: no eclipse
    assert M.eclipse_share(*_pair(0.0))[0] == 0.0  # Earth (0.95 deg) covers the Sun (0.27 deg)
    assert M.eclipse_share(*_pair(0.6))[0] == 0.0  # still inside Earth's disk
    a = math.degrees(math.asin(M.R_SUN_KM / M.AU_KM))
    b = math.degrees(math.asin(M.R_EARTH_KM / 384_400.0))
    just_touching = M.eclipse_share(*_pair(a + b - 1e-4))[0]
    assert 0.999 < just_touching < 1.0
    # Earth's edge through the Sun's center: a little under half is covered
    # (Earth's edge curves away from the Sun).
    half = M.eclipse_share(*_pair(b))[0]
    assert 0.5 < half < 0.6


def test_eclipse_share_decreases_as_earth_moves_in():
    seps = np.linspace(1.3, 0.6, 30)
    shares = [M.eclipse_share(*_pair(s))[0] for s in seps]
    assert all(x >= y for x, y in zip(shares, shares[1:]))


def test_eclipse_scales_flux_not_lit():
    sun, earth = _pair(0.95)
    s = M.site_series(sun, earth, FLAT)
    assert s["lit"][0] and 0 < s["eclipse"][0] < 1
    m = M.window_metrics(s, 0, 1)
    assert m["mean_flux_w_m2"]["tracking"] == pytest.approx(M.SOLAR_CONSTANT_W_M2 * s["eclipse"][0])
