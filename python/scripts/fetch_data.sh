#!/usr/bin/env bash
# Download SPICE kernels and LOLA DEM tiles into python/data/ (gitignored).
# Safe to re-run: existing files are skipped, partial downloads resume.
# Total size is about 2 GB, mostly the 20 m near-field DEM.
set -euo pipefail

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

NAIF=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
fetch "$NAIF/lsk/naif0012.tls"                    "$DATA/kernels/naif0012.tls"
fetch "$NAIF/pck/pck00011.tpc"                    "$DATA/kernels/pck00011.tpc"
fetch "$NAIF/pck/moon_pa_de440_200625.bpc"        "$DATA/kernels/moon_pa_de440_200625.bpc"
fetch "$NAIF/fk/satellites/moon_de440_250416.tf"  "$DATA/kernels/moon_de440_250416.tf"
fetch "$NAIF/spk/planets/de440s.bsp"              "$DATA/kernels/de440s.bsp"

# LOLA gridded DEMs, south polar stereographic. Heights relative to 1737.4 km.
LOLA=https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img
for name in ldem_80s_20m ldem_75s_120m; do   # near field 80-90S, far field 75-90S
  fetch "$LOLA/$name.lbl" "$DATA/dem/$name.lbl"
  fetch "$LOLA/$name.img" "$DATA/dem/$name.img"
done

# TODO: equator (Apollo 11) and far-side (Chang'e-4) sites need a global or
# mid-latitude DEM. Decide at milestone 5.
echo "done"
