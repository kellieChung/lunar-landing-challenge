import type { SiteData } from './types';

export async function loadSite(id: string): Promise<SiteData> {
  const url = `${import.meta.env.BASE_URL}data/${id}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return (await res.json()) as SiteData;
}
