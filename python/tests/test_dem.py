"""Layered elevation maps (5 m site tiles over the 20 m / 240 m maps), on small made-up GeoTIFFs."""

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from lunar import dem as D
from lunar.horizon import sample_distances_km

CRS = {"proj": "stere", "lat_0": -90, "lat_ts": -90, "lon_0": 0, "x_0": 0, "y_0": 0,
       "R": D.R_MOON_M, "units": "m", "no_defs": True}
LAT, LON = -88.51566, -61.167319444  # de Gerlache Rim 2


def write_tile(path, left, top, size_px, res_m, value):
    data = np.full((size_px, size_px), value, dtype=np.float32)
    with rasterio.open(path, "w", driver="GTiff", width=size_px, height=size_px, count=1,
                       dtype="float32", crs=CRS, transform=from_origin(left, top, res_m, res_m),
                       nodata=np.nan) as dst:
        dst.write(data, 1)
    return path


@pytest.fixture
def maps(tmp_path):
    """A 5 m tile (100 m high, 4 x 4 km) on a 20 m map (0 m) on a 240 m map (-50 m)."""
    cx, cy = D.polar_stereo_xy(LAT, LON)
    cx, cy = float(cx), float(cy)
    write_tile(tmp_path / "TEST_final_adj_5mpp_surf.tif", cx - 2000, cy + 2000, 800, 5.0, 100.0)
    write_tile(tmp_path / "LDEM_80S_20MPP_ADJ.TIF", cx - 10000, cy + 10000, 1000, 20.0, 0.0)
    write_tile(tmp_path / "LDEM_60S_240MPP_ADJ.TIF", cx - 48000, cy + 48000, 400, 240.0, -50.0)
    return tmp_path, cx, cy


def height_at(dem, x, y):
    lat, lon = D.polar_stereo_latlon(np.atleast_1d(x), np.atleast_1d(y))
    return dem(lat, lon)


def test_finest_map_wins_and_coarser_fill_in(maps):
    d, cx, cy = maps
    dem = D.load_site_dem(LAT, LON, radius_km=40, verbose=False, dem_dir=d)
    assert [p.path.name for p in dem.detail] == ["TEST_final_adj_5mpp_surf.tif"]
    assert height_at(dem, cx, cy)[0] == pytest.approx(100.0)  # inside the 5 m tile
    assert height_at(dem, cx + 5000, cy)[0] == pytest.approx(0.0)  # 20 m map only
    assert height_at(dem, cx + 20000, cy)[0] == pytest.approx(-50.0)  # 240 m map only
    assert np.isnan(height_at(dem, cx + 60000, cy)[0])  # no map at all


def test_tile_edge_blends_linearly(maps):
    d, cx, cy = maps
    dem = D.load_site_dem(LAT, LON, radius_km=40, verbose=False, dem_dir=d)
    edge = cx + 2000 - 5.0  # one pixel inside the tile's east edge: weight 0 starts here
    xs = edge - np.array([0.0, 50.0, 100.0, 150.0, 200.0, 400.0])
    h = height_at(dem, xs, np.full_like(xs, cy))
    np.testing.assert_allclose(h, [0.0, 25.0, 50.0, 75.0, 100.0, 100.0], atol=1e-3)


def test_tile_discovery(maps, tmp_path):
    d, _, _ = maps
    (d / "OTHER_final_adj_5mpp_surf.tif.crdownload").write_bytes(b"partial")
    (d / "OTHER2_5mpp_surf.tif.part").write_bytes(b"")
    assert [p.name for p in D.find_detail_tiles(d)] == ["TEST_final_adj_5mpp_surf.tif"]
    # A tile far from the site is not used.
    assert D.site_detail_tiles(-84.20156, 60.69989, dem_dir=d) == []
    # A tile that can't be read yet is skipped with a warning, not an error.
    (d / "BROKEN_5mpp_surf.tif").write_bytes(b"not a tiff")
    with pytest.warns(UserWarning, match="BROKEN"):
        assert [p.name for p in D.site_detail_tiles(LAT, LON, dem_dir=d)] == ["TEST_final_adj_5mpp_surf.tif"]


def test_10mpp_crops_are_site_tiles(maps):
    d, cx, cy = maps
    write_tile(d / "test-site_10mpp_crop.tif", cx + 1000, cy + 3000, 300, 10.0, 50.0)
    (d / "other-site_10mpp_crop.tif.part").write_bytes(b"")  # still being written
    assert [p.name for p in D.find_detail_tiles(d)] == ["TEST_final_adj_5mpp_surf.tif",
                                                         "test-site_10mpp_crop.tif"]
    # The near map's own name must not match the 10 m pattern.
    assert "LDEM_80S_20MPP_ADJ.TIF" not in [p.name for p in D.find_detail_tiles(d)]


def test_nearest_tile_first(maps):
    d, cx, cy = maps
    # A neighbour's tile overlapping this site, named so it sorts first alphabetically.
    write_tile(d / "AAA_neighbour_5mpp_surf.tif", cx - 1000, cy + 9000, 1600, 5.0, 999.0)
    assert [p.name for p in D.site_detail_tiles(LAT, LON, dem_dir=d)] == [
        "TEST_final_adj_5mpp_surf.tif", "AAA_neighbour_5mpp_surf.tif"]
    dem = D.load_site_dem(LAT, LON, radius_km=40, verbose=False, dem_dir=d)
    assert height_at(dem, cx, cy)[0] == pytest.approx(100.0)  # the site's own tile wins


def test_int16_scale():
    from lunar.terrain import int16_scale, to_int16
    assert int16_scale(np.array([-3000.0, 3200.0])) == pytest.approx(0.1)
    assert int16_scale(np.array([-5000.0, 100.0])) == pytest.approx(0.2)
    with pytest.raises(ValueError, match="int16"):
        to_int16(np.array([4000.0]), 0.1)


def test_plain_functions_as_layers():
    near = lambda lat, lon: np.where(np.asarray(lat) < -88, 7.0, np.nan)
    far = lambda lat, lon: np.full(np.shape(lat), 1.0)
    dem = D.LayeredDEM([near, far])
    np.testing.assert_array_equal(dem(np.array([-89.0, -87.0]), np.array([0.0, 0.0])), [7.0, 1.0])


def test_sample_steps():
    s = sample_distances_km()
    assert s[0] == pytest.approx(0.1) and s[-1] == pytest.approx(150.0)
    np.testing.assert_allclose(np.diff(s[s <= 2.0 + 1e-9]), 0.01, atol=1e-9)  # 10 m to 2 km
    mid = s[(s >= 2.0 - 1e-9) & (s <= 5.0 + 1e-9)]
    np.testing.assert_allclose(np.diff(mid), 0.05, atol=1e-9)  # 50 m to 5 km
    assert np.all(np.diff(s) > 0)
