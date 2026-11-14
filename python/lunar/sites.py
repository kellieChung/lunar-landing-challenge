"""Curated landing sites.

Coordinates must come from NASA/LROC/mission sources and be cited in
docs/VALIDATION.md. Never fill these in from memory or by guessing.
A site with lat/lon = None is a placeholder waiting for the astronomer.
"""

from dataclasses import dataclass

KINDS = ("south-pole", "equator", "far-side")


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    lat: float | None  # degrees, planetocentric, south negative
    lon: float | None  # degrees east
    kind: str
    blurb: str
    source: str  # citation for the coordinates

    @property
    def has_coords(self) -> bool:
        return self.lat is not None and self.lon is not None


TODO = "TODO(astronomer): coordinates + citation"

SITES: list[Site] = [
    Site("apollo-11", "Apollo 11", None, None, "equator",
         "Equator baseline: Sun climbs high, Earth parked in the sky", TODO),
    # TODO(astronomer): Chandrayaan-3 is ~69 deg S; confirm whether "kind"
    # should be "south-pole" or a new "high-latitude" kind.
    Site("chandrayaan-3", "Chandrayaan-3", None, None, "south-pole",
         "High-latitude landing that worked", TODO),
    Site("im-1", "Intuitive Machines IM-1 (Malapert area)", None, None, "south-pole",
         "Real CLPS pole lander that lost power early", TODO),
    Site("shackleton-ridge", "Shackleton connecting ridge", None, None, "south-pole",
         "Among the most-lit terrain on the Moon", TODO),
    Site("shackleton-floor", "Inside Shackleton crater", None, None, "south-pole",
         "Permanently shadowed: never lit", TODO),
    # Coordinates provided by the team; citation still needed.
    Site("artemis-candidate", "Nobile Rim 2 (Artemis III candidate region)",
         -84.20156, 60.69989, "south-pole",
         "Where would you land?",
         "TODO(astronomer): cite source for Nobile Rim 2 coordinates"),
    Site("change-4", "Chang'e-4 (far side)", None, None, "far-side",
         "Earth never rises: why it needed a relay satellite", TODO),
]


def get_site(site_id: str) -> Site:
    """Return a site by id. Raises if unknown or if coordinates are missing."""
    for site in SITES:
        if site.id == site_id:
            if not site.has_coords:
                raise ValueError(
                    f"Site '{site_id}' has no coordinates yet ({site.source})."
                )
            return site
    raise KeyError(f"Unknown site id '{site_id}'")


def site_index(data_dir) -> list[dict]:
    """Site list for the web picker (web/public/data/sites.json).

    lat/lon stay None (JSON null) for placeholder sites, so the globe never
    places a pin we don't have a cited coordinate for. has_data says whether
    <data_dir>/<id>.json has been built yet.
    """
    from pathlib import Path

    data_dir = Path(data_dir)
    return [
        {"id": s.id, "name": s.name, "kind": s.kind, "blurb": s.blurb,
         "lat": s.lat, "lon": s.lon,
         "has_data": (data_dir / f"{s.id}.json").exists()}
        for s in SITES
    ]
