"""Made-up horizon mask, used only for the web/public/data/fake.json test file.

This is NOT terrain data. Any JSON using it must say so ("fake" or "mask_fake").
"""

import math


def fake_mask() -> list[float]:
    """360 made-up horizon elevations (deg), one per degree of azimuth."""
    mask = []
    for az in range(360):
        a = math.radians(az)
        h = 1.2 + 0.8 * math.sin(2 * a + 0.5) + 0.5 * math.sin(5 * a + 1.3) + 0.3 * math.sin(11 * a)
        h += 2.5 * math.exp(-(((az - 250) / 12) ** 2))  # a tall peak
        h += 1.4 * math.exp(-(((az - 40) / 6) ** 2))  # a sharp peak near grid north
        mask.append(round(max(h, -0.5), 2))
    return mask
