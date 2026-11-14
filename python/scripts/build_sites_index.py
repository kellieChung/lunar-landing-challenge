"""Write web/public/data/sites.json, the site list the globe picker reads.

    python/.venv/bin/python python/scripts/build_sites_index.py

Rerun after filling coordinates in lunar/sites.py or building a new site JSON
(build_site.py also refreshes it automatically).
"""

import json
from pathlib import Path

from lunar.sites import site_index

WEB_DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def write_index(data_dir: Path = WEB_DATA) -> Path:
    out = data_dir / "sites.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"sites": site_index(data_dir)}, indent=1) + "\n")
    return out


if __name__ == "__main__":
    print(f"wrote {write_index()}")
