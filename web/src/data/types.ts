// Shape of web/public/data/<site_id>.json (see spec section 6).

export type SiteKind = 'south-pole' | 'reference';

export interface Vectors {
  e: number[];
  n: number[];
  u: number[];
}

export interface GridPoint {
  i: number;
  j: number;
  dx_km: number;
  dy_km: number;
  up_tilt: [number, number]; // the point's up in the site frame: [east, north] parts
  lat?: number;
  lon?: number;
  ground_m?: number; // terrain height at the point (m, LOLA datum)
  mask_deg: number[]; // 360 values, horizon elevation per 1 deg of azimuth (physics uses only this)
  mask_bands_deg?: number[][]; // 3 x 360: same, per distance band (3D rendering only)
}

/** Header of <site_id>_terrain.bin, the near-field heightmap (rendering only). */
export interface TerrainHeader {
  file: string;
  format: string; // "float32-le", or "int16-le" (value * scale_m metres)
  scale_m?: number; // int16-le only
  sources?: string[]; // detail heightmap: the elevation maps it was made from, finest first
  nx: number;
  ny: number;
  spacing_m: number;
  x0_m: number;
  y0_m: number;
  ground_m: number;
  order: string;
  z: string;
}

export interface SiteData {
  fake?: boolean; // whole file is made up (milestone 1 test data)
  mask_fake?: boolean; // real Sun/Earth, but the terrain mask is still made up
  site: {
    id: string;
    name: string;
    lat: number | null;
    lon: number | null;
    kind: SiteKind;
    blurb: string;
    ground_height_m?: number;
    mast_height_m?: number;
  };
  frame: { description: string };
  time: { start: string; step_hours: number; count: number };
  sun: Vectors & { r_au: number[] };
  earth: Vectors & { r_km?: number[] };
  grid: { spacing_km: number; size: number; mask_bands_km?: number[][]; points: GridPoint[] };
  terrain?: TerrainHeader;
  terrain_detail?: TerrainHeader; // 10 m heightmap around the grid, cropped to a patch around the chosen point
  precomputed: Record<string, unknown>;
}

/** One grid point in sites.json: where it is and its full-year numbers (for the globe's dots). */
export interface GridSummary {
  i: number;
  j: number;
  dx_km: number;
  dy_km: number;
  lat: number;
  lon: number;
  ground_m: number;
  sunlit_pct: number;
  earth_pct: number;
  both_pct: number;
  longest_dark_h: number;
  longest_blackout_h: number;
}

// Shape of web/public/data/sites.json (written by python/scripts/build_sites_index.py).
export interface SiteIndexEntry {
  id: string;
  name: string;
  kind: SiteKind;
  blurb: string;
  lat: number | null; // null = coordinates not cited yet (TODO astronomer)
  lon: number | null;
  has_data: boolean; // web/public/data/<id>.json exists
  grid?: GridSummary[]; // built sites with an 11 x 11 grid
}
