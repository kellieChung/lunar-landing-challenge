"""Curated landing sites.

Nine south-pole sites matching NASA's Artemis III candidate landing regions
(spec.MD, "Curated sites"). Coordinates are the exact values from the team's
brief: latitude negative = south, longitude in degrees east (-180..180).
Do not round them. Four come from the astronomer's papers ("paper 1",
"paper 2"; full citations TODO); the rest are still uncited placeholders
from the brief. Blurbs are TODO(astronomer).
"""

from dataclasses import dataclass
from pathlib import Path

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
PAPER1 = "paper 1, TODO(astronomer): full citation"
PAPER2 = "paper 2, TODO(astronomer): full citation"

SITES: list[Site] = [
    Site("cabeus-b-peak", "Peak near Cabeus B", -83.661, -69.014, "south-pole", BLURB_TODO, CITE_TODO),
    # Paper 2 gives 338.33290 deg E; the same longitude in -180..180 is -21.66710.
    Site("haworth", "Haworth", -86.80402, -21.66710, "south-pole", BLURB_TODO, PAPER2),
    Site("malapert-massif", "Malapert Massif", -85.995, -0.236, "south-pole", BLURB_TODO, CITE_TODO),
    Site("mons-mouton-plateau", "Mons Mouton Plateau", -84.232, 29.926, "south-pole", BLURB_TODO, CITE_TODO),
    Site("mons-mouton", "Mons Mouton", -85.423, 31.586, "south-pole", BLURB_TODO, CITE_TODO),
    Site("nobile-rim-1", "Nobile Rim 1", -85.54419, 37.62660, "south-pole", BLURB_TODO, PAPER2),
    Site("nobile-rim-2", "Nobile Rim 2", -84.20156, 60.69989, "south-pole", BLURB_TODO, PAPER1),
    Site("de-gerlache-rim-2", "de Gerlache Rim 2", -88.51566, 61.16732, "south-pole", BLURB_TODO, PAPER1),
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


def grid_summary(site_file) -> list[dict] | None:
    """Per-point year numbers from a built site file, for the globe's grid dots.

    None for files without a grid (older builds).
    """
    import json

    data = json.loads(Path(site_file).read_text())
    pts = data.get("precomputed", {}).get("points")
    if not pts:
        return None
    by_ij = {(p["i"], p["j"]): p for p in data["grid"]["points"]}
    out = []
    for pre in pts:
        p, y = by_ij[(pre["i"], pre["j"])], pre["year"]
        out.append({"i": p["i"], "j": p["j"], "dx_km": p["dx_km"], "dy_km": p["dy_km"],
                    "lat": p["lat"], "lon": p["lon"], "ground_m": p["ground_m"],
                    "sunlit_pct": round(y["sunlit_pct"], 2), "earth_pct": round(y["earth_pct"], 2),
                    "both_pct": round(y["both_pct"], 2), "longest_dark_h": y["longest_dark_h"],
                    "longest_blackout_h": y["longest_blackout_h"]})
    return out


def site_index(data_dir) -> list[dict]:
    """Site list for the web picker (web/public/data/sites.json).

    lat/lon stay None (JSON null) for placeholder sites, so the globe never
    places a pin we don't have a coordinate for. has_data says whether
    <data_dir>/<id>.json has been built yet; built sites with a grid also get
    "grid": one small record per grid point (position and year numbers).
    """
    data_dir = Path(data_dir)
    out = []
    for s in SITES:
        path = data_dir / f"{s.id}.json"
        entry = {"id": s.id, "name": s.name, "kind": s.kind, "blurb": s.blurb,
                 "lat": s.lat, "lon": s.lon, "has_data": path.exists()}
        if path.exists():
            grid = grid_summary(path)
            if grid:
                entry["grid"] = grid
        out.append(entry)
    return out
