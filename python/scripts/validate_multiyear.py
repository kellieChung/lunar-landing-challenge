"""Tables for docs/VALIDATION.md: the grid summary, 2027 against 2026-2044, and eclipses.

    python/.venv/bin/python python/scripts/validate_multiyear.py

Published illumination figures are long-term averages, and the Moon's
orbit takes 18.6 years to come back to the same tilt, so one calendar year
is not the average. This runs each site center over 19 years (6-hour step)
with the horizon mask from the shipped site file. Nothing here is shipped
to the browser.
"""

import json
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from lunar import ephemeris as E
from lunar import metrics as M
from lunar.sites import SITES

WEB_DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
START = "2026-01-01T00:00:00Z"
YEARS = 19
STEP_H = 6
PER_YEAR = 365 * 24 // STEP_H


def grid_table() -> None:
    print("| site | center ground | center sunlit | grid min | grid max (best spot) "
          "| center Earth visible | grid Earth visible | grid ground |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for s in SITES:
        d = json.loads((WEB_DATA / f"{s.id}.json").read_text())
        pts = {(p["i"], p["j"]): p for p in d["grid"]["points"]}
        yrs = {(p["i"], p["j"]): p["year"] for p in d["precomputed"]["points"]}
        sun = {k: v["sunlit_pct"] for k, v in yrs.items()}
        earth = [v["earth_pct"] for v in yrs.values()]
        ground = [p["ground_m"] for p in pts.values()]
        best = max(sun, key=sun.get)
        print(f"| {s.id} " + f"| {pts[(0, 0)]['ground_m']:.0f} m | {sun[(0, 0)]:.1f}% | {min(sun.values()):.1f}% "
              f"| {sun[best]:.1f}% ({best[0]}, {best[1]}) | {yrs[(0, 0)]['earth_pct']:.1f}% "
              f"| {min(earth):.1f}–{max(earth):.1f}% | {min(ground):.0f} to {max(ground):.0f} m |".replace("-", "−"))


def multiyear_table() -> None:
    print("\n| site | sunlit 2027 | sunlit 2026–2044 (min / mean / max per year) | any part of the Sun, mean "
          "| Earth 2027 | Earth 2026–2044 (min / mean / max) | longest night in 19 y |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for s in SITES:
        d = json.loads((WEB_DATA / f"{s.id}.json").read_text())
        c = next(p for p in d["grid"]["points"] if p["i"] == 0 and p["j"] == 0)
        eph = E.site_ephemeris(s.lat, s.lon, START, PER_YEAR * YEARS, STEP_H,
                               d["site"]["mast_height_m"], ground_m=c["ground_m"])
        ser = M.site_series(eph["sun"], eph["earth"], c["mask_deg"])
        per = lambda flags: [100 * flags[k * PER_YEAR:(k + 1) * PER_YEAR].mean() for k in range(YEARS)]
        sun, earth = per(ser["lit"]), per(ser["earth"])
        y = d["precomputed"]["center"]["year"]
        print(f"| {s.id} | {y['sunlit_pct']:.1f}% | {min(sun):.1f} / {np.mean(sun):.1f} / {max(sun):.1f}% "
              f"| {100 * np.mean(ser['fraction'] > 0):.1f}% | {y['earth_pct']:.1f}% "
              f"| {min(earth):.1f} / {np.mean(earth):.1f} / {max(earth):.1f}% "
              f"| {M.longest_run(~ser['lit']) * STEP_H} h |")


def eclipse_table(site_id: str = "nobile-rim-1", start: str = "2026-01-01T00:00:00Z", years: int = 5) -> None:
    """Eclipses of the Sun by Earth seen from one site (they are nearly the same at all nine)."""
    s = next(x for x in SITES if x.id == site_id)
    d = json.loads((WEB_DATA / f"{s.id}.json").read_text())
    step_h = 1 / 6
    eph = E.site_ephemeris(s.lat, s.lon, start, int(years * 8766 / step_h), step_h,
                           d["site"]["mast_height_m"], ground_m=d["site"]["ground_height_m"])
    share = M.eclipse_share(eph["sun"], eph["earth"])
    idx = np.where(share < 1)[0]
    t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
    print(f"\n| eclipse begins (UTC, seen from {s.id}) | lasts | most of the Sun covered | fully covered for |")
    print("| --- | --- | --- | --- |")
    for g in np.split(idx, np.where(np.diff(idx) > 1)[0] + 1):
        when = t0 + timedelta(hours=float(g[0]) * step_h)
        print(f"| {when:%Y-%m-%d %H:%M} | {len(g) * step_h:.1f} h | {100 * (1 - share[g].min()):.0f}% "
              f"| {(share[g] == 0).sum() * step_h:.1f} h |")


if __name__ == "__main__":
    grid_table()
    E.load_kernels()
    multiyear_table()
    eclipse_table()
