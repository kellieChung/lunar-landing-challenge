#!/usr/bin/env bash
# Download SPICE kernels and LOLA DEM tiles into python/data/ (gitignored).
# Safe to re-run: existing files are skipped, partial downloads resume.
# Total size is about 2 GB, mostly the 20 m near-field DEM.
#
# Usage: fetch_data.sh [kernels|dem|all]   (default: all)
#   kernels  SPICE kernels only (~60 MB), for the Sun/Earth ephemeris
#   dem      LOLA elevation maps (~2.8 GB), for the horizons and terrain
set -euo pipefail

MODE="${1:-all}"
case "$MODE" in kernels|dem|all) ;; *) echo "usage: $0 [kernels|dem|all]" >&2; exit 1;; esac

cd "$(dirname "$0")/.."
DATA=data
mkdir -p "$DATA/kernels" "$DATA/dem"

fetch() {  # fetch <url> <dest>
  local url="$1" dest="$2"
  if [[ -f "$dest" && ! -f "$dest.part" ]]; then
    echo "have  $dest"
    return
  fi
  echo "get   $url"
  touch "$dest.part"
  curl -fL --retry 3 -C - -o "$dest" "$url"
  rm -f "$dest.part"
}

if [[ "$MODE" == kernels || "$MODE" == all ]]; then
NAIF=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
fetch "$NAIF/lsk/naif0012.tls"                    "$DATA/kernels/naif0012.tls"
fetch "$NAIF/pck/pck00011.tpc"                    "$DATA/kernels/pck00011.tpc"
fetch "$NAIF/pck/moon_pa_de440_200625.bpc"        "$DATA/kernels/moon_pa_de440_200625.bpc"
fetch "$NAIF/fk/satellites/moon_de440_250416.tf"  "$DATA/kernels/moon_de440_250416.tf"
fetch "$NAIF/spk/planets/de440s.bsp"              "$DATA/kernels/de440s.bsp"
fi

if [[ "$MODE" == dem || "$MODE" == all ]]; then
# LOLA south-pole elevation maps from NASA GSFC PGDA (Barker et al. 2023,
# PSJ 4, 183). Heights in metres relative to a 1737.4 km sphere,
# south polar stereographic, MOON_ME (DE421).
PGDA=https://pgda.gsfc.nasa.gov/data/LOLA_20mpp
# Near field: 80-90 S at 20 m/pixel (2.6 GB). Accept a copy saved as .tiff.
if [[ -f "$DATA/dem/LDEM_80S_20MPP_ADJ.tiff" ]]; then
  echo "have  $DATA/dem/LDEM_80S_20MPP_ADJ.tiff"
else
  fetch "$PGDA/LDEM_80S_20MPP_ADJ.TIF" "$DATA/dem/LDEM_80S_20MPP_ADJ.TIF"
fi
# Far field: 60-90 S at 240 m/pixel (210 MB), used where the near map has no data.
fetch "$PGDA/LDEM_60S_240MPP_ADJ.TIF" "$DATA/dem/LDEM_60S_240MPP_ADJ.TIF"
# 10 m/pixel 30 x 30 km windows of LDEM_83S_10MPP_ADJ (5.1 GB) for sites with no 5 m tile
# (Cabeus B peak, Slater Plain). Range reads, about 35 MB per site.
.venv/bin/python scripts/fetch_10mpp_crops.py
fi

# 5 m/pixel LOLA site tiles (*_5mpp_surf.tif, e.g. SL2_final_adj_5mpp_surf.tif) are downloaded
# by hand into data/dem/. lunar/dem.py finds them (and the 10 m crops) by location.

echo "done"
