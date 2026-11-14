"""Points used to validate the ephemeris against JPL Horizons.

Only "nobile-rim-2" (Nobile Rim 2) is a real landing site (from lunar/sites.py).
The other two are math test points, NOT landing sites: they exist only to
check our code against NASA's calculator at very different latitudes.
They are never shown in the app.
"""

from lunar.sites import get_site

_nobile = get_site("nobile-rim-2")

VALIDATION_POINTS = {
    "nobile-rim-2": (_nobile.lat, _nobile.lon),
    "test-equator": (0.0, 0.0),  # math test point, not a landing site
    "test-near-pole": (-89.5, 0.0),  # math test point, not a landing site
}

# Five moments spread across 2027 (UTC).
VALIDATION_TIMES = [
    "2027-01-01 00:00",
    "2027-03-20 06:00",
    "2027-06-15 12:00",
    "2027-09-23 18:00",
    "2027-12-31 23:00",
]

MAST_HEIGHT_M = 3.0


def angle_between_deg(a, b) -> float:
    """Angle between two direction vectors, in degrees."""
    import numpy as np

    a, b = np.asarray(a, float), np.asarray(b, float)
    cos = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))


def compare_with_horizons(rows: list[dict]) -> list[dict]:
    """Compute our az/el for each Horizons row and the differences.

    Kernels must already be loaded (lunar.ephemeris.load_kernels).
    """
    import numpy as np

    from lunar import ephemeris as E

    out = []
    for r in rows:
        et = np.array([E.spice.str2et(r["time"] + " UTC")])
        pos = E.site_position_km(r["lat"], r["lon"], MAST_HEIGHT_M)
        enu, _ = E.body_enu(r["body"], et, pos, E.site_frame(r["lat"], r["lon"]))
        az, el = E.az_el(enu[0, 0], enu[0, 1], enu[0, 2])
        az_h, el_h = np.radians(r["az_deg"]), np.radians(r["el_deg"])
        horizons_vec = [np.cos(el_h) * np.sin(az_h), np.cos(el_h) * np.cos(az_h), np.sin(el_h)]
        d_az = (float(az) - r["az_deg"] + 180.0) % 360.0 - 180.0
        out.append({**r, "our_az": float(az), "our_el": float(el),
                    "d_az": d_az, "d_el": float(el) - r["el_deg"],
                    "sep_deg": angle_between_deg(enu[0], horizons_vec)})
    return out
