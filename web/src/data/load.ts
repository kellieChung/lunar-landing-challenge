import type { SiteData, SiteIndexEntry } from './types';

async function getJson<T>(path: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadSite(id: string): Promise<SiteData> {
  return getJson<SiteData>(`data/${id}.json`);
}

export async function loadSiteIndex(): Promise<SiteIndexEntry[]> {
  return (await getJson<{ sites: SiteIndexEntry[] }>('data/sites.json')).sites;
}
