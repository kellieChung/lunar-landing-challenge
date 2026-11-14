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
  fake?: boolean;
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
