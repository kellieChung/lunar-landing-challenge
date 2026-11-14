// Shape of web/public/data/<site_id>.json (see spec section 6).

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
  up_tilt: [number, number];
  mask_deg: number[]; // 360 values, horizon elevation per 1 deg of azimuth
}

export interface SiteData {
  fake?: boolean; // whole file is made up (milestone 1 test data)
  mask_fake?: boolean; // real Sun/Earth, but the terrain mask is still made up
  site: {
    id: string;
    name: string;
    lat: number | null;
    lon: number | null;
    kind: 'south-pole' | 'equator' | 'far-side';
    blurb: string;
  };
  frame: { description: string };
  time: { start: string; step_hours: number; count: number };
  sun: Vectors & { r_au: number[] };
  earth: Vectors;
  grid: { spacing_km: number; size: number; points: GridPoint[] };
  precomputed: Record<string, unknown>;
}

// Shape of web/public/data/sites.json (written by python/scripts/build_sites_index.py).
export interface SiteIndexEntry {
  id: string;
  name: string;
  kind: 'south-pole' | 'equator' | 'far-side';
  blurb: string;
  lat: number | null; // null = coordinates not cited yet (TODO astronomer)
  lon: number | null;
  has_data: boolean; // web/public/data/<id>.json exists
}
