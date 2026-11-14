"""Fetch Sun/Earth az/el from JPL Horizons for the validation points.

Run once (needs internet); the result is committed so tests run offline:
    python/.venv/bin/python python/scripts/fetch_horizons.py

Writes python/tests/fixtures/horizons_2027.json
"""

import json
import urllib.parse
import urllib.request
from pathlib import Path

from lunar.validation import MAST_HEIGHT_M, VALIDATION_POINTS, VALIDATION_TIMES

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "horizons_2027.json"
BODIES = {"SUN": "10", "EARTH": "399"}


def query(body_id: str, lat: float, lon: float) -> list[dict]:
    params = {
        "format": "text",
        "COMMAND": f"'{body_id}'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",  # a site on the Moon
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},{MAST_HEIGHT_M / 1000}'",  # E-lon, lat, alt (km)
        "TLIST": " ".join(f"'{t}'" for t in VALIDATION_TIMES),
        "TIME_TYPE": "'UT'",
        "QUANTITIES": "'4,20'",  # apparent az/el, range
        "ANG_FORMAT": "'DEG'",
        "EXTRA_PREC": "'YES'",
        "CSV_FORMAT": "'YES'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode()
    if "$$SOE" not in text:
        raise RuntimeError(f"Unexpected Horizons response:\n{text[:2000]}")
    if "MEAN_ME" not in text:
        raise RuntimeError("Horizons did not use the MEAN_ME lunar frame; check the request.")
    rows = []
    for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        rows.append({"time_utc": f[0], "az_deg": float(f[3]), "el_deg": float(f[4]),
                     "range_au": float(f[5])})
    return rows


def main() -> None:
    results = []
    for point, (lat, lon) in VALIDATION_POINTS.items():
        for body, body_id in BODIES.items():
            for t, row in zip(VALIDATION_TIMES, query(body_id, lat, lon)):
                results.append({"point": point, "lat": lat, "lon": lon, "body": body,
                                "time": t, **row})
            print(f"ok {point} {body}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "JPL Horizons API (ssd.jpl.nasa.gov)",
                               "mast_height_m": MAST_HEIGHT_M, "rows": results}, indent=1))
    print(f"wrote {OUT} ({len(results)} rows)")


if __name__ == "__main__":
    main()
