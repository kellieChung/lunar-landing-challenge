"""Visibility and metrics: is the Sun up, can we see Earth, and for how long.

Everything here is a comparison between where the Sun or Earth is (unit
vectors in the site frame, one per hour) and the horizon mask (360 values,
one per degree of azimuth). The browser has an exact port in
web/src/physics/ (metrics.ts, events.ts, visibility.ts); a shared fixture
(tests/fixtures/metrics_parity.json) checks that both give the same answers.

Definitions
-----------
- mask_at(az): horizon elevation at any azimuth, by linear interpolation in
  the 360-value mask, wrapping at 360 deg.
- Sunlit fraction: the Sun is a disk about 0.53 deg wide. We test 9 points
  of it (the center plus 8 points on a ring at r/sqrt(2), r = the Sun's
  angular radius) and return the fraction above the horizon: 0 = dark, 1 = fully lit.
- Lit: sunlit fraction >= 0.5.
- Earth visible: Earth's center is above the horizon (margin > 0). The
  margin (deg) tells the UI when Earth is only partly visible.
- Flux (W/m^2): 1361 / r_au^2 x sunlit fraction x panel factor, where the
  panel factor is 1 (Sun-tracking), sin(el) (horizontal) or cos(el)
  (vertical, facing the Sun).

Times are "sample indices": t = 0 is the first sample, t = 1 the next one
(one hour later for hourly data); fractions of a sample are allowed.
"""

import math

import numpy as np

from lunar.ephemeris import AU_KM, az_el

SOLAR_CONSTANT_W_M2 = 1361.0  # TODO(astronomer): cite (e.g. IAU 2015 nominal total solar irradiance)
R_SUN_KM = 695_700.0  # IAU 2015 nominal solar radius, same as web/src/physics/constants.ts
LIT_THRESHOLD = 0.5  # sunlit fraction that counts as "lit"
DISK_RING = 1.0 / math.sqrt(2.0)  # ring radius of the disk sample points, as a fraction of r
RING_ANGLES_DEG = (0, 45, 90, 135, 180, 225, 270, 315)  # 0 = top of the disk, clockwise
N_DISK_POINTS = 1 + len(RING_ANGLES_DEG)
EPS_SAMPLES = 1e-6  # "strictly after" for event searches
BISECT_STEPS = 40  # halves one hour 40 times: far below a second


# ---- Instantaneous visibility ----------------------------------------------

def mask_at(mask, az_deg):
    """Horizon elevation (deg) at any azimuth: linear interpolation, wrapping at 360."""
    mask = np.asarray(mask, float)
    n = len(mask)
    f = np.mod(np.asarray(az_deg, float), 360.0) / 360.0 * n
    i0 = np.floor(f).astype(int) % n
    i1 = (i0 + 1) % n
    t = f - np.floor(f)
    return mask[i0] * (1 - t) + mask[i1] * t


def sun_radius_deg(r_au):
    """Angular radius of the Sun (deg) seen from r_au astronomical units."""
    return np.degrees(np.arcsin(R_SUN_KM / (np.asarray(r_au, float) * AU_KM)))


def margin_deg(e, n, u, mask):
    """How far a direction is above the horizon at its azimuth (deg); < 0 = hidden."""
    az, el = az_el(e, n, u)
    return el - mask_at(mask, az)


def sunlit_fraction(e, n, u, r_au, mask):
    """Fraction of the Sun's disk above the horizon (9-point sample): 0, 1/9, ..., 1."""
    az, el = az_el(e, n, u)
    ring = sun_radius_deg(r_au) * DISK_RING
    count = (el > mask_at(mask, az)).astype(float)
    for a in np.radians(RING_ANGLES_DEG):
        p_el = el + ring * np.cos(a)
        p_az = az + ring * np.sin(a) / np.cos(np.radians(el))  # degrees of azimuth shrink with elevation
        count = count + (p_el > mask_at(mask, p_az))
    return count / N_DISK_POINTS


def flux_w_m2(r_au, fraction, sun_el_deg) -> dict:
    """Solar power per square metre of panel for the three panel types."""
    full = SOLAR_CONSTANT_W_M2 / np.asarray(r_au, float) ** 2 * np.asarray(fraction, float)
    el = np.radians(sun_el_deg)
    return {
        "tracking": full,
        "vertical": full * np.cos(el),
        "horizontal": full * np.maximum(0.0, np.sin(el)),
    }


# ---- Hourly series ----------------------------------------------------------

def site_series(sun: dict, earth: dict, mask) -> dict:
    """Per-sample visibility for one grid point.

    sun: {"e","n","u","r_au"} arrays; earth: {"e","n","u"} arrays (site frame).
    """
    e, n, u = (np.asarray(sun[k], float) for k in "enu")
    r_au = np.asarray(sun["r_au"], float)
    _, sun_el = az_el(e, n, u)
    fraction = sunlit_fraction(e, n, u, r_au, mask)
    earth_margin = margin_deg(*(np.asarray(earth[k], float) for k in "enu"), mask)
    return {
        "fraction": fraction,
        "sun_el": sun_el,
        "earth_margin": earth_margin,
        "r_au": r_au,
        "lit": fraction >= LIT_THRESHOLD,
        "earth": earth_margin > 0,
    }


def longest_run(flags) -> int:
    """Length of the longest run of True values."""
    best = run = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    return best


def window_metrics(series: dict, start: int, length: int, step_hours: float = 1.0) -> dict:
    """Summary numbers for the samples start .. start+length-1.

    Dark and blackout stretches are clipped to the window (a night that began
    before the window only counts the part inside it).
    """
    s = slice(start, start + length)
    lit, earth, frac = series["lit"][s], series["earth"][s], series["fraction"][s]
    flux = flux_w_m2(series["r_au"][s], frac, series["sun_el"][s])
    count = len(lit)
    return {
        "samples": count,
        "sunlit_pct": 100.0 * lit.sum() / count,
        "mean_sunlit_fraction": float(frac.mean()),
        "earth_pct": 100.0 * earth.sum() / count,
        "both_pct": 100.0 * (lit & earth).sum() / count,
        "longest_dark_h": longest_run(~lit) * step_hours,
        "longest_blackout_h": longest_run(~earth) * step_hours,
        "mean_flux_w_m2": {k: float(v.mean()) for k, v in flux.items()},
    }


def rounded_metrics(m: dict, digits: int = 6) -> dict:
    """Metrics with floats rounded, for the JSON files."""
    out = {}
    for k, v in m.items():
        out[k] = rounded_metrics(v, digits) if isinstance(v, dict) else round(float(v), digits)
        if k == "samples":
            out[k] = int(v)
    return out


# ---- Between samples: interpolation and events ------------------------------

def _bracket(t: float, count: int) -> tuple[int, float]:
    i0 = min(max(int(math.floor(t)), 0), count - 2)
    return i0, t - i0


def vector_at(v: dict, t: float) -> tuple[float, float, float]:
    """Direction at fractional sample t: linear interpolation, then normalized."""
    i0, f = _bracket(t, len(v["e"]))
    x = np.array([(1 - f) * v[k][i0] + f * v[k][i0 + 1] for k in "enu"], float)
    return tuple(x / np.linalg.norm(x))


def value_at(values, t: float) -> float:
    i0, f = _bracket(t, len(values))
    return (1 - f) * values[i0] + f * values[i0 + 1]


def sun_lit_at(sun: dict, mask, t: float) -> bool:
    """Is the Sun lit (fraction >= 0.5) at fractional sample t?"""
    e, n, u = vector_at(sun, t)
    return bool(sunlit_fraction(e, n, u, value_at(sun["r_au"], t), mask) >= LIT_THRESHOLD)


def earth_visible_at(earth: dict, mask, t: float) -> bool:
    """Is Earth's center above the horizon at fractional sample t?"""
    return bool(margin_deg(*vector_at(earth, t), mask) > 0)


def next_flip(state_at, hourly, s: float):
    """First time after s when the state differs from its value at s, or None.

    state_at(t) -> bool at any time; hourly[j] = state at sample j.
    Finds the first sample that differs, then bisects within that hour.
    (A flip that reverts within the same hour is not seen.)
    """
    count = len(hourly)
    s0 = state_at(s)
    for j in range(int(math.floor(s)) + 1, count):
        if bool(hourly[j]) != s0:
            lo, hi = max(s, j - 1.0), float(j)
            for _ in range(BISECT_STEPS):
                mid = 0.5 * (lo + hi)
                if state_at(mid) == s0:
                    lo = mid
                else:
                    hi = mid
            return hi
    return None


def next_change(state_at, hourly, t: float, to_state: bool):
    """First time strictly after t when the state becomes to_state, or None.

    Sunrise = next_change(lit, ..., True), sunset = (..., False); same for
    Earthrise and Earthset. The returned time already has the new state.
    """
    s = t + EPS_SAMPLES
    if s > len(hourly) - 1:
        return None
    if state_at(s) == to_state:  # already in that state: wait for it to end first
        s = next_flip(state_at, hourly, s)
        if s is None:
            return None
    return next_flip(state_at, hourly, s)
