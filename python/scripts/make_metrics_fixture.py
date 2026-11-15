"""Write python/tests/fixtures/metrics_parity.json: shared Python <-> TypeScript test data.

Each case holds its own inputs (mask + Sun/Earth vectors) and the answers
from lunar/metrics.py. python/tests/test_metrics.py and
web/src/physics/metrics.test.ts both recompute them and must agree.

    python/.venv/bin/python python/scripts/make_metrics_fixture.py

Rerun after changing lunar/metrics.py (then make the TypeScript match).
"""

import json
import math
from pathlib import Path

import numpy as np

from lunar import metrics as M
from lunar.grid import point_vectors

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "web" / "public" / "data" / "nobile-rim-2.json"
OUT = ROOT / "python" / "tests" / "fixtures" / "metrics_parity.json"

SLICE = (150, 1150)  # 1000 hours of Nobile Rim 2 with two sunrises/sunsets and Earthrises/sets


ECLIPSE_SLICE = (5440, 5520)  # 2027-08-17: Earth covers up to 45% of the Sun


def real_case(ij=(0, 0), span=SLICE, site_path=SITE, windows=None, events=None) -> dict:
    """A slice of a shipped file at grid point ij. Off-center points carry
    their up_tilt; both languages rotate the vectors with it before anything else."""
    site = json.loads(site_path.read_text())
    a, b = span
    point = next(p for p in site["grid"]["points"] if (p["i"], p["j"]) == ij)
    case = {
        "name": f"{site['site']['id']} point {ij} samples {a}-{b - 1}",
        "step_hours": 1,
        "mask": point["mask_deg"],
        "sun": {k: site["sun"][k][a:b] for k in ("e", "n", "u", "r_au")},
        "earth": {k: site["earth"][k][a:b] for k in ("e", "n", "u", "r_km")},
        "windows": windows or [[0, 720], [300, 500], [0, 1000]],
        "events": events if events is not None else [
            [0, "sun", True], [0, "sun", False], [0, "earth", True], [0, "earth", False],
            [100.5, "sun", True], [400.25, "earth", False], [999, "sun", True]],
    }
    if ij != (0, 0):
        case["tilt"] = point["up_tilt"]
    return case


def synthetic_case() -> dict:
    """Sun sliding across azimuth 0 (north) at 1.1 deg elevation, past a ridge at 359-1 deg."""
    mask = [0.0] * 360
    mask[359] = mask[0] = mask[1] = 2.0  # a ridge straddling north
    az = np.radians(np.linspace(-10.3, 9.7, 41))  # 349.7 deg .. 9.7 deg, 0.5 deg per sample
    el = np.radians(1.1)  # off the 1 deg grid, so no exact ties
    vec = lambda a: {"e": list(np.cos(el) * np.sin(a)), "n": list(np.cos(el) * np.cos(a)),
                     "u": [math.sin(el)] * len(a)}
    sun = {**vec(az), "r_au": [1.0] * len(az)}
    earth = vec(az[::-1])  # same path, the other way
    return {
        "name": "synthetic: Sun crosses a ridge at north (azimuth wrap)",
        "step_hours": 1,
        "mask": mask,
        "sun": sun,
        "earth": earth,
        "windows": [[0, 41], [10, 15]],
        "events": [[0, "sun", False], [0, "sun", True], [0, "earth", False], [20.5, "earth", True]],
    }


def point_inputs(case: dict) -> tuple[dict, dict]:
    """Sun/Earth vectors as seen from the case's grid point (rotated by its tilt)."""
    if "tilt" not in case:
        return case["sun"], case["earth"]
    return point_vectors(case["sun"], case["tilt"]), point_vectors(case["earth"], case["tilt"])


def answers(case: dict) -> dict:
    mask = case["mask"]
    sun, earth = point_inputs(case)
    s = M.site_series(sun, earth, mask)
    lit_at = lambda t: M.sun_lit_at(sun, mask, t)
    earth_at = lambda t: M.earth_visible_at(earth, mask, t)
    events = []
    for t, body, to in case["events"]:
        state_at, hourly = (lit_at, s["lit"]) if body == "sun" else (earth_at, s["earth"])
        events.append(M.next_change(state_at, hourly, t, to))
    return {
        "fraction": s["fraction"].tolist(),
        "eclipse": s["eclipse"].tolist(),
        "earth_margin": s["earth_margin"].tolist(),
        "windows": [M.window_metrics(s, a, n, case["step_hours"]) for a, n in case["windows"]],
        "events": events,
    }


def main() -> None:
    cases = [real_case(), synthetic_case(), real_case((4, -3)),
             real_case(span=ECLIPSE_SLICE, site_path=SITE.with_name("nobile-rim-1.json"),
                       windows=[[0, 80], [30, 20]], events=[])]
    for c in cases:
        c["expected"] = answers(c)
    OUT.write_text(json.dumps({"cases": cases}, indent=None, allow_nan=False, default=float))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")
    for c in cases:
        print(c["name"], "events:", c["expected"]["events"])


if __name__ == "__main__":
    main()
