"""Horizon masks from the LOLA DEM.  (Milestone 3)

Plan:
- For each grid point and each of 360 azimuths (1 deg step, site frame),
  walk outward from 0.1 km to 150 km (fine steps near, ~1% of distance far).
- Exact 3D elevation angle: asin(dot(P - O, up_O) / |P - O|), max over samples.
- Near-field DEM inside its coverage, far-field DEM beyond.
"""
