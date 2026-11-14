"""Print the ephemeris-vs-Horizons comparison as a markdown table.

    python/.venv/bin/python python/scripts/validate_horizons.py

Paste the output into docs/VALIDATION.md section 2.
"""

import json
from pathlib import Path

import numpy as np

from lunar import ephemeris as E
from lunar.validation import VALIDATION_POINTS, compare_with_horizons

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "horizons_2027.json"


def main() -> None:
    E.load_kernels()
    rows = compare_with_horizons(json.loads(FIXTURE.read_text())["rows"])
    print("| point | time (UTC) | body | Horizons az / el (°) | ours az / el (°) | Δaz (″) | Δel (″) | separation (″) |")
    print("| --- | --- | --- | --- | --- | ---: | ---: | ---: |")
    for r in rows:
        print(f"| {r['point']} | {r['time']} | {r['body'].title()} "
              f"| {r['az_deg']:.4f} / {r['el_deg']:.4f} | {r['our_az']:.4f} / {r['our_el']:.4f} "
              f"| {r['d_az'] * 3600:.3f} | {r['d_el'] * 3600:.3f} | {r['sep_deg'] * 3600:.3f} |")
    seps = np.array([r["sep_deg"] for r in rows])
    print(f"\nWorst separation: {seps.max() * 3600:.3f}″ ({seps.max():.6f}°), "
          f"median {np.median(seps) * 3600:.3f}″, over {len(rows)} comparisons.")

    print("\nSanity checks, full year 2027 hourly:")
    for name, (lat, lon) in VALIDATION_POINTS.items():
        d = E.site_ephemeris(lat, lon, "2027-01-01T00:00:00Z", 8760)
        _, sun_el = E.az_el(d["sun"]["e"], d["sun"]["n"], d["sun"]["u"])
        e_az, e_el = E.az_el(d["earth"]["e"], d["earth"]["n"], d["earth"]["u"])
        print(f"| {name} | {lat}, {lon} | {sun_el.min():.2f} to {sun_el.max():.2f} "
              f"| {e_el.min():.2f} to {e_el.max():.2f} "
              f"| {np.degrees(np.arcsin(d['earth']['e'])).min():.2f} to {np.degrees(np.arcsin(d['earth']['e'])).max():.2f} "
              f"| {np.degrees(np.arcsin(d['earth']['n'])).min():.2f} to {np.degrees(np.arcsin(d['earth']['n'])).max():.2f} |")


if __name__ == "__main__":
    main()
