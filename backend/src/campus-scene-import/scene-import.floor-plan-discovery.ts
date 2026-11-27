import { isIP } from 'node:net';
import { assertLiveExternalEffect } from '../common/simulation-effects.js';

const BRAVE_WEB_SEARCH = 'https://api.search.brave.com/res/v1/web/search';
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_CANDIDATES = 3;

export type PublicFloorPlanLink = { title: string; url: string; source_host: string };
export type FloorPlanDiscovery =
  | { status: 'found' | 'not_found'; candidates: PublicFloorPlanLink[] }
  | { status: 'unavailable'; candidates: []; reason: string };

export const floorPlanSearchUnavailable = (reason: string): FloorPlanDiscovery => ({
  status: 'unavailable', candidates: [], reason,
});

export function floorPlanSearchSettings() {
  const apiKey = process.env.CAMPUS_FLOOR_PLAN_SEARCH_API_KEY?.trim();
  const maximumDailyLookups = Number(process.env.CAMPUS_FLOOR_PLAN_SEARCH_MAX_DAILY);
  if (!apiKey || !Number.isInteger(maximumDailyLookups) || maximumDailyLookups < 1 || maximumDailyLookups > 1000)
    return null;
  return { apiKey, maximumDailyLookups };
}

function officialUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || hostname.length > 200 || isIP(hostname)
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/u.test(hostname)
      || /\.(?:localhost|local|internal|home|lan|localhost\.localdomain|test|example|invalid|onion)$/u.test(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function officialSchoolHost(value: string): string | null {
  const host = officialUrl(value)?.hostname;
  return host?.replace(/^www\./u, '') ?? null;
}

function normalWords(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function containsWords(haystack: string, needle: string) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function publicFloorPlanLinks(
  payload: unknown, officialHost: string, building: string, floor?: string,
): PublicFloorPlanLink[] {
  if (!payload || typeof payload !== 'object' || !('web' in payload) || !payload.web || typeof payload.web !== 'object'
    || !('results' in payload.web) || !Array.isArray(payload.web.results)) return [];
  const buildingWords = normalWords(building);
  const floorWords = floor ? normalWords(floor) : '';
  const links = new Map<string, PublicFloorPlanLink>();
  for (const item of payload.web.results.slice(0, 10) as unknown[]) {
    if (!item || typeof item !== 'object' || !('url' in item) || typeof item.url !== 'string'
      || item.url.length > 1024 || !('title' in item) || typeof item.title !== 'string') continue;
    const url = officialUrl(item.url);
    // Unknown query parameters can be credentials or redirect endpoints.
    // Only return direct, same-origin document or page links from the public index.
    if (!url || url.search || url.pathname === '/' || officialSchoolHost(url.href) !== officialHost) continue;
    const title = item.title.replace(/\s+/gu, ' ').trim().slice(0, 180);
    if (!title || /[<>\p{Cc}]/u.test(title)) continue;
    const description = 'description' in item && typeof item.description === 'string' ? item.description.slice(0, 600) : '';
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { continue; }
    const subject = normalWords(`${title} ${path}`);
    const evidence = normalWords(`${subject} ${description}`);
    if (!/\b(?:floor ?plans?|floor layout|level plans?)\b/u.test(subject)
      || !containsWords(evidence, buildingWords)
      || (floorWords && !containsWords(evidence, floorWords))) continue;
    url.hash = '';
    links.set(url.href, { title, url: url.href, source_host: url.hostname });
    if (links.size >= MAX_CANDIDATES) break;
  }
  return [...links.values()];
}

async function readSearchResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('Public search unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Public search result too large');
    }
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** The indexed evidence is discovery only. This adapter never contacts a result URL. */
export async function discoverPublicFloorPlans(
  settings: NonNullable<ReturnType<typeof floorPlanSearchSettings>>,
  source: { host: string; building: string; floor?: string },
): Promise<FloorPlanDiscovery> {
  assertLiveExternalEffect('Public floor-plan search');
  const endpoint = new URL(BRAVE_WEB_SEARCH);
  const building = normalWords(source.building).slice(0, 100);
  const floor = source.floor ? normalWords(source.floor).slice(0, 50) : '';
  if (!building) return floorPlanSearchUnavailable('Give this building a campus name before searching for a public floor plan.');
  endpoint.searchParams.set('q', `site:${source.host} "${building}"${floor ? ` "${floor}"` : ''} "floor plan"`);
  endpoint.searchParams.set('count', '10');
  endpoint.searchParams.set('result_filter', 'web');
  endpoint.searchParams.set('text_decorations', 'false');
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': settings.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    const candidates = publicFloorPlanLinks(await readSearchResponse(response), source.host, source.building, source.floor);
    return { status: candidates.length ? 'found' : 'not_found', candidates };
  } catch {
    return floorPlanSearchUnavailable('Public floor-plan search could not finish. Try again or use guided setup.');
  }
}
