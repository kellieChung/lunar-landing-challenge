import { parseTerrain, type Heightmap } from '../panorama3d/heightmap';
import type { SiteData, SiteIndexEntry, TerrainHeader } from './types';

function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function getJson<T>(path: string): Promise<T> {
  const url = dataUrl(path);
  const res = await fetch(url);
  // Dev servers answer missing files with index.html, so check the type too.
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  if (!res.ok || !isJson) throw new Error(`Not found: ${url} (${res.status})`);
  return (await res.json()) as T;
}

export function loadSite(id: string): Promise<SiteData> {
  return getJson<SiteData>(`data/${id}.json`);
}

export async function loadSiteIndex(): Promise<SiteIndexEntry[]> {
  return (await getJson<{ sites: SiteIndexEntry[] }>('data/sites.json')).sites;
}

/** The near-field heightmap for the 3D view. */
export async function loadTerrain(h: TerrainHeader): Promise<Heightmap> {
  const url = dataUrl(`data/${h.file}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return parseTerrain(await res.arrayBuffer(), h);
}
