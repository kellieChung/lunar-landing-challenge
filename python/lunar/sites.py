"""Curated landing sites.

Nine south-pole sites matching NASA's Artemis III candidate landing regions
(spec.MD, "Curated sites"). Coordinates are the exact values from the team's
brief: latitude negative = south, longitude in degrees east (-180..180).
Do not round them. Citations and blurbs are still TODO(astronomer).
"""

from dataclasses import dataclass

KINDS = ("south-pole", "reference")


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


BLURB_TODO = "TODO(astronomer)"
CITE_TODO = "TODO(astronomer): cite"
PAPER_TODO = "paper, TODO(astronomer): full citation"

SITES: list[Site] = [
    Site("cabeus-b-peak", "Peak near Cabeus B", -83.661, -69.014, "south-pole", BLURB_TODO, CITE_TODO),
    Site("haworth", "Haworth", -86.764, -22.777, "south-pole", BLURB_TODO, CITE_TODO),
    Site("malapert-massif", "Malapert Massif", -85.995, -0.236, "south-pole", BLURB_TODO, CITE_TODO),
    Site("mons-mouton-plateau", "Mons Mouton Plateau", -84.232, 29.926, "south-pole", BLURB_TODO, CITE_TODO),
    Site("mons-mouton", "Mons Mouton", -85.423, 31.586, "south-pole", BLURB_TODO, CITE_TODO),
    Site("nobile-rim-1", "Nobile Rim 1", -85.438, 37.367, "south-pole", BLURB_TODO, CITE_TODO),
    Site("nobile-rim-2", "Nobile Rim 2", -84.20156, 60.69989, "south-pole", BLURB_TODO, PAPER_TODO),
    Site("de-gerlache-rim-2", "de Gerlache Rim 2", -88.51566, 61.16732, "south-pole", BLURB_TODO, PAPER_TODO),
    Site("slater-plain", "Slater Plain", -87.149, 126.134, "south-pole", BLURB_TODO, CITE_TODO),
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
