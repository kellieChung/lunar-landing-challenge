// Lat/lon on the globe mesh, in three.js world coordinates (Y up).
//
// The moon mesh follows the MOON_ME body-fixed convention in Blender
// (+Z north, +X = lon 0 facing Earth, +Y = lon 90 deg E; see
// python/scripts/export_moon.py). glTF export turns Blender (x, y, z)
// into three (x, z, -y), so:  north -> +Y,  lon 0 -> +X,  lon 90E -> -Z.

const DEG = Math.PI / 180;

/** Unit vector [x, y, z] pointing from the Moon's center to (lat, lon) in degrees. */
export function latLonToVec(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
}

/** "84.20° S, 60.70° E" style label. */
export function formatLatLon(latDeg: number, lonDeg: number): string {
  const lon = ((lonDeg + 540) % 360) - 180; // [-180, 180)
  const ns = latDeg < 0 ? 'S' : 'N';
  const ew = lon < 0 ? 'W' : 'E';
  return `${Math.abs(latDeg).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}
