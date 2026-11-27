import { File, Directory, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';

const inFlight = new Map<string, Promise<string>>();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TILES = 512;
const MAX_TILE_BYTES = 512 * 1024;
const USER_AGENT = 'ThatCampus (app.thatcampus.mobile; https://thatcampus.com)';

type TileCacheMetadata = {
  expiresAt: number;
  lifetime: number;
  etag?: string;
  lastModified?: string;
};

function readMetadata(file: File): TileCacheMetadata | undefined {
  if (!file.exists) return;
  try {
    const value = JSON.parse(file.textSync());
    if (Number.isFinite(value.expiresAt) && Number.isFinite(value.lifetime)) return value;
  } catch { /* A partial cache write is repaired by fetching the visible tile. */ }
}

function trimCache(cache: Directory) {
  const tiles = cache.list().filter((file): file is File => file instanceof File && file.extension === '.png');
  if (tiles.length <= MAX_TILES) return;
  for (const file of tiles.sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))) {
    const metadata = new File(cache, file.name.replace(/\.png$/, '.json'));
    if ((readMetadata(metadata)?.expiresAt ?? 0) > Date.now()) continue;
    const key = file.name.replace(/\.png$/, '');
    if (inFlight.has(key)) continue;
    if (file.exists) file.delete();
    if (metadata.exists) metadata.delete();
  }
}

async function loadTile(url: string, key: string) {
  const cache = new Directory(Paths.cache, 'virtual-campus-osm-tiles');
  cache.create({ idempotent: true });
  const tile = new File(cache, `${key}.png`);
  const metadataFile = new File(cache, `${key}.json`);
  const metadata = tile.exists ? readMetadata(metadataFile) : undefined;
  if (metadata && metadata.expiresAt > Date.now()) return tile.uri;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (metadata?.etag) headers['If-None-Match'] = metadata.etag;
  if (metadata?.lastModified) headers['If-Modified-Since'] = metadata.lastModified;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'error' });
    const control = response.headers.get('cache-control') ?? '';
    const maxAge = control.match(/(?:^|,)\s*max-age=(\d+)/i);
    const expires = Date.parse(response.headers.get('expires') ?? '');
    const age = Number(response.headers.get('age') ?? 0) || 0;
    const now = Date.now();
    const lifetime = /\bno-cache\b/i.test(control) ? 0
      : maxAge ? Math.max(0, Number(maxAge[1]) - age) * 1000
      : Number.isFinite(expires) ? Math.max(0, expires - now)
      : response.status === 304 ? metadata?.lifetime ?? WEEK_MS : WEEK_MS;
    const next: TileCacheMetadata = {
      expiresAt: now + lifetime,
      lifetime,
      etag: response.headers.get('etag') ?? metadata?.etag,
      lastModified: response.headers.get('last-modified') ?? metadata?.lastModified,
    };
    if (response.status !== 304 || !tile.exists) {
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png') ||
        Number(response.headers.get('content-length')) > MAX_TILE_BYTES) throw new Error('Map tile unavailable');
      const bytes = await response.bytes();
      if (bytes.length > MAX_TILE_BYTES) throw new Error('Map tile too large');
      if (/\bno-store\b/i.test(control)) {
        if (tile.exists) tile.delete();
        if (metadataFile.exists) metadataFile.delete();
        const encoded = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
        return 'data:image/png;base64,' + btoa(encoded);
      }
      tile.write(bytes);
    }
    metadataFile.write(JSON.stringify(next));
    return tile.uri;
  } finally {
    clearTimeout(timeout);
    try { trimCache(cache); } catch { /* Cached tile remains usable if housekeeping fails. */ }
  }
}

export function campusAreaMapTileSource(url: string): Promise<string> {
  const path = url.match(/^https:\/\/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!path) return Promise.reject(new Error('Unrecognized map tile URL'));
  const key = path.slice(1).join('-');
  const current = inFlight.get(key);
  if (current) return current;
  const request = loadTile(url, key).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
