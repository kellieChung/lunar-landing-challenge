"""Checks on the site files shipped to the browser (no map files needed)."""

import json
from pathlib import Path

import numpy as np
import pytest

WEB_DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
SHIPPED = sorted(p.stem for p in WEB_DATA.glob("*.json") if p.stem not in ("sites", "fake"))


def _reject_nan(token):
    raise ValueError(f"non-JSON number {token} in shipped file")


@pytest.fixture(params=SHIPPED)
def site(request):
    path = WEB_DATA / f"{request.param}.json"
    return json.loads(path.read_text(), parse_constant=_reject_nan)


def test_the_built_sites_are_shipped():
    assert {"nobile-rim-1", "nobile-rim-2", "de-gerlache-rim-2", "haworth",
            "malapert-massif", "mons-mouton", "mons-mouton-plateau",
            "cabeus-b-peak", "slater-plain"} <= set(SHIPPED)


def test_grid_is_11_by_11_with_one_center(site):
    g = site["grid"]
    assert g["size"] == 11 and g["spacing_km"] == 1
    pts = g["points"]
    assert len(pts) == 121
    assert sorted({(p["i"], p["j"]) for p in pts}) == [(i, j) for i in range(-5, 6) for j in range(-5, 6)]
    centers = [p for p in pts if p["dx_km"] == 0 and p["dy_km"] == 0]
    assert len(centers) == 1
    c = centers[0]
    assert c["up_tilt"] == [0.0, 0.0]
    assert (c["lat"], c["lon"]) == (site["site"]["lat"], site["site"]["lon"])
    assert c["ground_m"] == site["site"]["ground_height_m"]


def test_tilt_matches_offset(site):
    # Points sit on the tangent plane at the center's ground, so their up leans
    # toward the offset by d / (R + ground_center) (radians, before normalizing).
    base_km = 1737.4 + site["site"]["ground_height_m"] / 1000
    for p in site["grid"]["points"]:
        assert p["dx_km"] == p["i"] and p["dy_km"] == p["j"]
        norm = np.sqrt(base_km**2 + p["dx_km"]**2 + p["dy_km"]**2)
        te, tn = p["up_tilt"]
        assert te == pytest.approx(p["dx_km"] / norm, abs=1e-7)
        assert tn == pytest.approx(p["dy_km"] / norm, abs=1e-7)


def test_precomputed_points_match_recomputation(site):
    from lunar.grid import point_vectors
    from lunar.metrics import rounded_metrics, site_series, window_metrics

    pre = {(q["i"], q["j"]): q["year"] for q in site["precomputed"]["points"]}
    assert len(pre) == 121
    pts = {(p["i"], p["j"]): p for p in site["grid"]["points"]}
    assert pre[(0, 0)] == site["precomputed"]["center"]["year"]
    for ij in [(-5, -5), (5, 5), (3, -2)]:
        p = pts[ij]
        s = site_series(point_vectors(site["sun"], p["up_tilt"]), point_vectors(site["earth"], p["up_tilt"]),
                        p["mask_deg"])
        n = site["time"]["count"]
        assert rounded_metrics(window_metrics(s, 0, n, site["time"]["step_hours"])) == pre[ij]


def test_bands_max_to_mask(site):
    for p in site["grid"]["points"]:
        bands = np.array(p["mask_bands_deg"])
        assert bands.shape == (3, 360)
        np.testing.assert_array_equal(bands.max(axis=0), p["mask_deg"])
    assert site["grid"]["mask_bands_km"] == [[0, 5], [5, 30], [30, 150]]


def test_terrain_file_matches_header(site):
    h = site["terrain"]
    raw = (WEB_DATA / h["file"]).read_bytes()
    assert h["format"] == "float32-le"
    assert len(raw) == h["nx"] * h["ny"] * 4
    z = np.frombuffer(raw, dtype="<f4").reshape(h["ny"], h["nx"])
    assert (h["nx"], h["ny"], h["spacing_m"]) == (201, 201, 100.0)  # 20 x 20 km
    assert np.isfinite(z).all()
    # Every grid point sits exactly on a vertex, at its own ground height
    # (measured along the center's up, so it includes the curvature drop).
    R = 1737400.0
    for p in site["grid"]["points"]:
        col = round((p["dx_km"] * 1000 - h["x0_m"]) / h["spacing_m"])
        row = round((p["dy_km"] * 1000 - h["y0_m"]) / h["spacing_m"])
        te, tn = p["up_tilt"]
        want = (R + p["ground_m"]) * np.sqrt(1 - te * te - tn * tn) - (R + h["ground_m"])
        assert z[row, col] == pytest.approx(want, abs=0.15), (p["i"], p["j"])
    assert z[h["ny"] // 2, h["nx"] // 2] == pytest.approx(0.0, abs=1e-3)  # observer's ground
    assert h["x0_m"] + (h["nx"] - 1) * h["spacing_m"] == -h["x0_m"]  # centered


def test_detail_file_matches_coarse(site):
    """The 10 m detail heightmap (sites built since the 5 m tiles) agrees with the 100 m one."""
    h = site.get("terrain_detail")
    if h is None:
        pytest.skip("built before the detail heightmap")
    raw = (WEB_DATA / h["file"]).read_bytes()
    assert h["format"] == "int16-le" and h["scale_m"] >= 0.1
    assert len(raw) == h["nx"] * h["ny"] * 2
    z = np.frombuffer(raw, dtype="<i2").reshape(h["ny"], h["nx"]) * h["scale_m"]
    assert (h["nx"], h["ny"], h["spacing_m"]) == (1301, 1301, 10.0)  # 13 x 13 km
    assert h["x0_m"] == -6500 and h["y0_m"] == -6500
    assert h["ground_m"] == site["terrain"]["ground_m"]
    assert z[650, 650] == pytest.approx(0.0, abs=0.05)
    # Every 10th detail vertex is a coarse vertex: same terrain, same place.
    c = site["terrain"]
    zc = np.frombuffer((WEB_DATA / c["file"]).read_bytes(), dtype="<f4").reshape(c["ny"], c["nx"])
    off = round((h["x0_m"] - c["x0_m"]) / c["spacing_m"])  # 35
    shared = zc[off:off + 131, off:off + 131]
    np.testing.assert_allclose(z[::10, ::10], shared, atol=h["scale_m"] / 2 + 0.01)
    assert h["sources"][-1].startswith("LDEM_80S_20MPP")


def test_earth_distance(site):
    r = np.array(site["earth"]["r_km"])
    assert len(r) == site["time"]["count"]
    assert 350_000 < r.min() and r.max() < 410_000


def test_precomputed_year_metrics(site):
    m = site["precomputed"]["center"]["year"]
    assert m["samples"] == site["time"]["count"]
    for k in ("sunlit_pct", "earth_pct", "both_pct"):
        assert 0 <= m[k] <= 100
    assert m["both_pct"] <= min(m["sunlit_pct"], m["earth_pct"])
    assert 0 <= m["mean_sunlit_fraction"] <= 1
    assert 0 <= m["longest_dark_h"] <= m["samples"]
    flux = m["mean_flux_w_m2"]
    assert 0 <= flux["horizontal"] <= flux["vertical"] <= flux["tracking"] < 1500
