import pytest

from lunar.sites import KINDS, SITES, get_site, site_index

# The table in spec.MD ("Curated sites"), copied exactly.
SPEC_TABLE = {
    "cabeus-b-peak": (-83.661, -69.014),
    "haworth": (-86.764, -22.777),
    "malapert-massif": (-85.995, -0.236),
    "mons-mouton-plateau": (-84.232, 29.926),
    "mons-mouton": (-85.423, 31.586),
    "nobile-rim-1": (-85.438, 37.367),
    "nobile-rim-2": (-84.20156, 60.69989),
    "de-gerlache-rim-2": (-88.51566, 61.16732),
    "slater-plain": (-87.149, 126.134),
}


def test_ids_unique():
    ids = [s.id for s in SITES]
    assert len(ids) == len(set(ids))


def test_nine_sites_match_spec_table():
    assert {s.id: (s.lat, s.lon) for s in SITES} == SPEC_TABLE


def test_all_sites_in_south_pole_region():
    for s in SITES:
        assert -88.6 <= s.lat <= -83.6, s.id
        assert -180 <= s.lon <= 180, s.id


def test_kinds_valid():
    for s in SITES:
        assert s.kind in KINDS, s.id


def test_blurbs_not_invented():
    for s in SITES:
        assert s.blurb.startswith("TODO(astronomer)"), s.id


def test_get_site():
    assert get_site("nobile-rim-2").lat == -84.20156
    with pytest.raises(KeyError):
        get_site("nope")


def test_site_index(tmp_path):
    (tmp_path / "nobile-rim-2.json").write_text("{}")
    index = site_index(tmp_path)
    assert [e["id"] for e in index] == [s.id for s in SITES]
    by_id = {e["id"]: e for e in index}
    assert by_id["nobile-rim-2"]["has_data"] is True
    assert by_id["haworth"]["has_data"] is False
