import json
from pathlib import Path

import numpy as np
import pytest

from lunar import ephemeris as E
from lunar.validation import VALIDATION_POINTS, compare_with_horizons

FIXTURE = Path(__file__).parent / "fixtures" / "horizons_2027.json"


# ---- Pure geometry (no kernels needed) -------------------------------------

def test_frame_at_equator_prime_meridian():
    east, north, up = E.site_frame(0.0, 0.0)
    np.testing.assert_allclose(up, [1, 0, 0], atol=1e-12)
    np.testing.assert_allclose(east, [0, 1, 0], atol=1e-12)
    np.testing.assert_allclose(north, [0, 0, 1], atol=1e-12)


@pytest.mark.parametrize("lat,lon", [(-84.20156, 60.69989), (-89.5, 0.0), (30.0, 200.0)])
def test_frame_is_orthonormal_right_handed(lat, lon):
    east, north, up = E.site_frame(lat, lon)
    m = np.stack([east, north, up])
    np.testing.assert_allclose(m @ m.T, np.eye(3), atol=1e-12)
    np.testing.assert_allclose(np.cross(east, north), up, atol=1e-12)


def test_frame_rejects_exact_pole():
    with pytest.raises(ValueError):
        E.site_frame(-90.0, 0.0)


def test_az_el_convention_matches_web():
    # Same convention as web/src/panorama/geometry.ts vecToAzEl.
    assert E.az_el(0, 1, 0)[0] == pytest.approx(0)
    assert E.az_el(1, 0, 0)[0] == pytest.approx(90)
    assert E.az_el(0, -1, 0)[0] == pytest.approx(180)
    assert E.az_el(-1, 0, 0)[0] == pytest.approx(270)
    assert E.az_el(0, 0, 1)[1] == pytest.approx(90)


def test_site_position_radius():
    p = E.site_position_km(-84.20156, 60.69989, height_m=3.0)
    assert np.linalg.norm(p) == pytest.approx(E.MOON_RADIUS_KM + 0.003)


# ---- Needs SPICE kernels ---------------------------------------------------

@pytest.fixture(scope="module")
def kernels():
    try:
        E.load_kernels()
    except FileNotFoundError as err:
        pytest.skip(f"SPICE kernels not downloaded: {err}")


def test_matches_jpl_horizons(kernels):
    rows = json.loads(FIXTURE.read_text())["rows"]
    results = compare_with_horizons(rows)
    assert len(results) == 30
    worst = max(results, key=lambda r: r["sep_deg"])
    print(f"\nworst separation vs Horizons: {worst['sep_deg']:.6f} deg "
          f"({worst['point']} {worst['body']} {worst['time']})")
    for r in results:
        assert r["sep_deg"] < 0.01, r


@pytest.fixture(scope="module")
def year(kernels):
    return {name: E.site_ephemeris(lat, lon, "2027-01-01T00:00:00Z", 8760)
            for name, (lat, lon) in VALIDATION_POINTS.items()}


def test_year_shape_and_units(year):
    for d in year.values():
        for body in ("sun", "earth"):
            v = np.stack([d[body]["e"], d[body]["n"], d[body]["u"]], axis=1)
            assert v.shape == (8760, 3)
            np.testing.assert_allclose(np.linalg.norm(v, axis=1), 1.0, atol=1e-12)
        assert 0.98 < d["sun"]["r_au"].min() and d["sun"]["r_au"].max() < 1.02


@pytest.mark.parametrize("name", ["nobile-rim-2", "test-near-pole"])
def test_sun_stays_near_horizon_at_high_latitude(year, name):
    # The Sun's height is bounded by the distance from the pole plus the
    # ~1.54 deg tilt of the Moon's axis (1.6 deg leaves a little room for
    # libration). TODO(astronomer): confirm and cite the 1.54 deg value. Near the pole this is the spec's "within ~1.6 deg"; at
    # Nobile Rim 2 (about 6 deg from the pole) the Sun can reach about 7 deg.
    lat = VALIDATION_POINTS[name][0]
    d = year[name]
    _, el = E.az_el(d["sun"]["e"], d["sun"]["n"], d["sun"]["u"])
    assert np.abs(el).max() <= (90 - abs(lat)) + 1.6


def test_earth_barely_moves_at_equator(year):
    # Sanity check: from (0, 0) Earth hangs near the zenith and only wobbles
    # by the libration, commonly quoted as about 7.9 deg in longitude and
    # 6.9 deg in latitude. TODO(astronomer): confirm and cite these values.
    d = year["test-equator"]
    east_offset = np.degrees(np.arcsin(d["earth"]["e"]))
    north_offset = np.degrees(np.arcsin(d["earth"]["n"]))
    assert np.abs(east_offset).max() < 8.0
    assert np.abs(north_offset).max() < 7.0


def test_shipped_site_json_matches_horizons():
    """The file the app actually loads must agree with Horizons at every
    validation time (checks hour indexing and 5-decimal rounding; catches a
    stale JSON that wasn't rebuilt). Needs no kernels."""
    from datetime import datetime

    from lunar.validation import angle_between_deg

    site_json = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "nobile-rim-2.json"
    data = json.loads(site_json.read_text())
    t0 = datetime.fromisoformat(data["time"]["start"].replace("Z", "+00:00"))
    rows = [r for r in json.loads(FIXTURE.read_text())["rows"] if r["point"] == "nobile-rim-2"]
    assert len(rows) == 10
    for r in rows:
        t = datetime.fromisoformat(r["time"] + "+00:00")
        k = round((t - t0).total_seconds() / 3600 / data["time"]["step_hours"])
        body = data[r["body"].lower()]
        ours = [body["e"][k], body["n"][k], body["u"][k]]
        az, el = np.radians(r["az_deg"]), np.radians(r["el_deg"])
        theirs = [np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)]
        assert angle_between_deg(ours, theirs) < 0.001, (r["body"], r["time"], k)
