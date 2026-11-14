"""Write web/public/data/fake.json: FAKE data for milestone 1 only.

The mask is a made-up sum of sines and bumps, and the Sun/Earth just circle
the horizon. None of it is physics. It exists so the panorama can be built
before the real pipeline (milestones 2-3) is ready. Same shape as the real
site JSON (see spec section 6).

Run:  python/.venv/bin/python python/scripts/make_fake_site.py
"""

import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "fake.json"
N_SAMPLES = 24  # hourly


def fake_mask() -> list[float]:
    mask = []
    for az in range(360):
        a = math.radians(az)
        h = 1.2 + 0.8 * math.sin(2 * a + 0.5) + 0.5 * math.sin(5 * a + 1.3) + 0.3 * math.sin(11 * a)
        h += 2.5 * math.exp(-(((az - 250) / 12) ** 2))  # a tall peak
        h += 1.4 * math.exp(-(((az - 40) / 6) ** 2))  # a sharp peak near grid north
        mask.append(round(max(h, -0.5), 2))
    return mask


def unit(az_deg: float, el_deg: float) -> tuple[float, float, float]:
    """Azimuth clockwise from grid north (toward east), elevation from horizon."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    return (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))


def series(az0: float, daz: float, el: float) -> dict:
    vecs = [unit(az0 + k * daz, el) for k in range(N_SAMPLES)]
    return {key: [round(v[i], 5) for v in vecs] for i, key in enumerate("enu")}


def main() -> None:
    sun = series(az0=130.0, daz=0.5, el=1.5)  # ~0.5 deg/hour along the horizon
    sun["r_au"] = [1.0] * N_SAMPLES
    earth = series(az0=10.0, daz=0.02, el=3.0)

    data = {
        "fake": True,
        "site": {"id": "fake", "name": "FAKE test site", "lat": None, "lon": None,
                 "kind": "south-pole", "blurb": "Made-up terrain for milestone 1"},
        "frame": {"description": "site-center ENU, azimuth from grid north"},
        "time": {"start": "2027-01-01T00:00:00Z", "step_hours": 1, "count": N_SAMPLES},
        "sun": sun,
        "earth": earth,
        "grid": {
            "spacing_km": 1, "size": 1,
            "points": [{"i": 0, "j": 0, "dx_km": 0, "dy_km": 0,
                        "up_tilt": [0.0, 0.0], "mask_deg": fake_mask()}],
        },
        "precomputed": {},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
