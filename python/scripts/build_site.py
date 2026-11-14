"""Build web/public/data/<site_id>.json for one curated site.

    python/.venv/bin/python python/scripts/build_site.py --site artemis-candidate

Milestone 2: real Sun/Earth vectors for calendar year 2027 (hourly).
The horizon mask is still the made-up one (marked "mask_fake": true) until
the real horizon arrives in milestone 3.
"""

import argparse
import json
from pathlib import Path

from lunar import ephemeris as E
from lunar.fake import fake_mask
from lunar.sites import get_site

WEB_DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
START = "2027-01-01T00:00:00Z"
COUNT = 8760  # hours in 2027
STEP_HOURS = 1
MAST_HEIGHT_M = 3.0


def r5(values) -> list[float]:
    return [round(float(v), 5) for v in values]


def build(site_id: str) -> Path:
    site = get_site(site_id)
    E.load_kernels()
    eph = E.site_ephemeris(site.lat, site.lon, START, COUNT, STEP_HOURS, MAST_HEIGHT_M)

    data = {
        "mask_fake": True,  # TODO(milestone 3): real horizon mask
        "site": {"id": site.id, "name": site.name, "lat": site.lat, "lon": site.lon,
                 "kind": site.kind, "blurb": site.blurb},
        "frame": {"description": "site-center ENU, azimuth from grid north"},
        "time": {"start": START, "step_hours": STEP_HOURS, "count": COUNT},
        "sun": {k: r5(v) for k, v in eph["sun"].items()},
        "earth": {k: r5(v) for k, v in eph["earth"].items()},
        "grid": {
            "spacing_km": 1, "size": 1,
            "points": [{"i": 0, "j": 0, "dx_km": 0, "dy_km": 0,
                        "up_tilt": [0.0, 0.0], "mask_deg": fake_mask()}],
        },
        "precomputed": {},
    }
    out = WEB_DATA / f"{site.id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, help="site id from lunar/sites.py")
    args = parser.parse_args()
    out = build(args.site)
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
