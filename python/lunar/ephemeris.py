"""Sun and Earth direction vectors in a site frame.  (Milestone 2)

Plan:
- Load SPICE kernels (see scripts/fetch_data.sh).
- For each hourly sample in 2027, get SUN and EARTH positions from MOON in
  MOON_ME with aberration correction LT+S (spkpos).
- Subtract the site position (radius 1737.4 km + DEM height + mast height)
  to get topocentric vectors, then rotate into the site-center ENU frame.
- Output unit vectors (e, n, u) for Sun and Earth plus Sun distance in AU.
"""
