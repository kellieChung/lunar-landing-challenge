import pytest

from lunar.sites import KINDS, SITES, get_site


def test_ids_unique():
    ids = [s.id for s in SITES]
    assert len(ids) == len(set(ids))


def test_seven_curated_sites():
    assert len(SITES) == 7


def test_coords_in_range_or_missing():
    for s in SITES:
        assert (s.lat is None) == (s.lon is None), s.id
        if s.has_coords:
            assert -90 <= s.lat <= 90, s.id
            assert -180 <= s.lon <= 360, s.id


def test_kinds_valid():
    for s in SITES:
        assert s.kind in KINDS, s.id


def test_get_site():
    assert get_site("artemis-candidate").lat == pytest.approx(-84.20156)
    with pytest.raises(ValueError):
        get_site("apollo-11")  # placeholder, no coordinates yet
    with pytest.raises(KeyError):
        get_site("nope")
