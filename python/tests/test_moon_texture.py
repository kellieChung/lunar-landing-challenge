"""Tests for lunar texture synthesis and hillshade calculation."""

import sys
from pathlib import Path
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import export_moon_texture as EMT


def test_compute_hillshade_flat():
    dem = np.full((100, 100), 500.0, dtype=np.float32)
    hs = EMT.compute_hillshade(dem, cellsize=10.0)
    assert hs.shape == (100, 100)
    assert hs.dtype == np.uint8
    assert np.all(hs > 0)
    assert np.all(hs <= 255)


def test_compute_hillshade_sloped():
    flat_dem = np.full((100, 100), 500.0, dtype=np.float32)
    # Slope facing NW (toward primary light source: az 315 deg)
    y, x = np.mgrid[0:100, 0:100]
    facing_dem = (x - y) * 5.0
    away_dem = -(x - y) * 5.0

    hs_flat = EMT.compute_hillshade(flat_dem, cellsize=10.0)
    hs_facing = EMT.compute_hillshade(facing_dem, cellsize=10.0)
    hs_away = EMT.compute_hillshade(away_dem, cellsize=10.0)

    # Facing the illumination should be brighter than facing away
    assert np.mean(hs_facing) > np.mean(hs_away)
    assert np.mean(hs_facing) != np.mean(hs_flat)


def test_generate_global_albedo():
    w, h = 128, 64
    albedo, bump = EMT.generate_global_albedo(w, h)
    assert albedo.shape == (h, w)
    assert bump.shape == (h, w)
    assert albedo.dtype == np.uint8
    assert bump.dtype == np.uint8

    # Check that maria regions are darker than base highland regions
    # Oceanus Procellarum is at lat 18.4, lon -57.4
    # Farside highlands (e.g. lat 20, lon 140) should be noticeably brighter
    lats = np.linspace(90, -90, h)
    lons = np.linspace(-180, 180, w)
    row_mare = np.argmin(np.abs(lats - 18.4))
    col_mare = np.argmin(np.abs(lons - (-57.4)))
    row_highland = np.argmin(np.abs(lats - 20.0))
    col_highland = np.argmin(np.abs(lons - 140.0))

    assert albedo[row_mare, col_mare] < albedo[row_highland, col_highland]
