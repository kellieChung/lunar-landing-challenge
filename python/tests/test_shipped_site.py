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


def test_something_is_shipped():
    assert "nobile-rim-2" in SHIPPED


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
    assert np.isfinite(z).all()
    assert z[h["ny"] // 2, h["nx"] // 2] == pytest.approx(0.0, abs=1e-3)  # observer's ground
    assert h["x0_m"] + (h["nx"] - 1) * h["spacing_m"] == -h["x0_m"]  # centered


def test_earth_distance(site):
    r = np.array(site["earth"]["r_km"])
    assert len(r) == site["time"]["count"]
    assert 350_000 < r.min() and r.max() < 410_000
