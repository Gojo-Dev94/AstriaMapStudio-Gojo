import type { MapDocument, MapSummary, TileAsset } from './domain.ts';
let token = sessionStorage.getItem('astria-token') ?? '';
export const setToken = (value: string) => { token = value; if (value) sessionStorage.setItem('astria-token', value); else sessionStorage.removeItem('astria-token'); };
export const hasToken = () => Boolean(token);
export const getToken = () => token;
export class ApiError extends Error { constructor(message: string, public status: number, public details?: string[]) { super(message); } }
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new ApiError(body.error ?? res.statusText, res.status, body.details); }
  return res.json() as Promise<T>;
}
const body = (value: unknown) => JSON.stringify(value);
export const api = {
  login: (username: string, password: string) => request<{ token: string; user: { sub: string; role: string } }>('/api/auth/login', { method: 'POST', body: body({ username, password }) }),
  me: () => request<{ sub: string; role: string }>('/api/auth/me'),
  maps: () => request<MapSummary[]>('/api/maps'),
  legacyMaps: (q = '') => request<{ id: number; dateMap: string }[]>(`/api/legacy/maps${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  map: (id: number) => request<MapDocument>(`/api/maps/${id}`),
  versions: (id: number) => request<{ version: number; author: string; savedAt: string }[]>(`/api/maps/${id}/versions`),
  version: (id: number, version: number) => request<MapDocument>(`/api/maps/${id}/versions/${version}`),
  create: (id: number, width: number, height: number, subArea: number) => request<MapDocument>('/api/maps', { method: 'POST', body: body({ id, width, height, subArea }) }),
  importLegacy: (id: number) => request<MapDocument>(`/api/legacy/maps/${id}/import`, { method: 'POST' }),
  decodeSwf: (data: string, filename: string) => request<MapDocument>('/api/legacy/swf/decode', { method: 'POST', body: body({ data, filename }) }),
  lock: (id: number) => request<{ owner: string; leaseSeconds: number }>(`/api/maps/${id}/lock`, { method: 'PUT' }),
  unlock: (id: number) => request<{ released: boolean }>(`/api/maps/${id}/lock`, { method: 'DELETE' }),
  save: (map: MapDocument, thumbnail: string, cellThumbnail: string) => request<MapDocument>(`/api/maps/${map.id}`, { method: 'PUT', body: body({ map, expectedVersion: map.version, thumbnail, cellThumbnail }) }),
  tiles: (cursor = 0) => request<{ items: TileAsset[]; nextCursor: number | null; total: number }>(`/api/tiles?cursor=${cursor}&limit=300`),
  metadata: (kind: 'areas' | 'subareas' | 'monsters') => request<{ id: number; name: string }[]>(`/api/${kind}`),
  areas: () => request<{ id: number; name: string; superarea: number }[]>('/api/areas'),
  subareas: () => request<{ id: number; name: string; area: number; superarea: number }[]>('/api/subareas'),
  world: () => request<{ id: number; x: number; y: number; area: number; subArea: number }[]>('/api/world'),
};
export async function fetchAllTiles(progress: (loaded: number, total: number) => void): Promise<TileAsset[]> {
  const all: TileAsset[] = []; let cursor: number | null = 0;
  while (cursor !== null) { const page = await api.tiles(cursor); all.push(...page.items); progress(all.length, page.total); cursor = page.nextCursor; }
  return all;
}
export function downloadText(name: string, contents: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
