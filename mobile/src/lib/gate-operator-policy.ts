export type GateLanguage = 'en' | 'hi';
export type GateOperatorSection = 'operate' | 'approvals' | 'records' | 'visitors';
export interface GateLanguageScope { origin: string; actorId: string; schoolId: string }

export const gateLanguage = (value: unknown): GateLanguage => value === 'hi' ? 'hi' : 'en';

/** This ordinary preference carries no credential, person data or world state. */
export function gateLanguagePreferenceKey(scope: GateLanguageScope): string {
  if (![scope.origin, scope.actorId, scope.schoolId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 512)) throw new Error('Choose an account and campus before saving the Gate language.');
  const source = JSON.stringify([scope.origin, scope.actorId, scope.schoolId]);
  return `thatcampus.gate.language.v1.${source.split('').map(value => value.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
}

export interface GatePreferenceStorage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
export function createGateLanguagePreferences(storage: GatePreferenceStorage) {
  const writes = new Map<string, Promise<void>>();
  return {
    async read(scope: GateLanguageScope): Promise<GateLanguage> { const key = gateLanguagePreferenceKey(scope); await writes.get(key)?.catch(() => {}); return gateLanguage(await storage.get(key)); },
    save(scope: GateLanguageScope, language: GateLanguage): Promise<void> {
      const key = gateLanguagePreferenceKey(scope), previous = writes.get(key);
      const write = (previous ?? Promise.resolve()).catch(() => {}).then(() => storage.set(key, gateLanguage(language)));
      writes.set(key, write); void write.finally(() => { if (writes.get(key) === write) writes.delete(key); }).catch(() => {});
      return write;
    },
  };
}

export function gateOperatorSection(href: string): GateOperatorSection | null {
  const values = new URLSearchParams(href.split('?')[1] ?? '').getAll('section');
  return values.length === 0 ? 'operate' : values.length === 1 && ['operate', 'approvals', 'records', 'visitors'].includes(values[0]!) ? values[0] as GateOperatorSection : null;
}
/** Keep unrelated attention/context filters; a new view clears only visitor focus/page. */
export function gateOperatorSectionHref(href: string, section: GateOperatorSection): string {
  const query = new URLSearchParams(href.split('?')[1] ?? '');
  query.delete('section'); query.delete('visitor'); query.delete('visitor_page');
  if (section !== 'operate') query.set('section', section);
  if (section === 'visitors' && !query.has('visitor_filter')) query.set('visitor_filter', 'active');
  return `${href.split('?')[0]}${query.size ? `?${query}` : ''}`;
}

/** Never let a phone field supply another URL scheme, dial command or query. */
export function gateOfficePhoneHref(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[\d ()\.\-]+$/.test(value.trim())) return null;
  const number = value.trim().replace(/[ ()\.\-]/g, '');
  return /^\+?\d{5,20}$/.test(number) ? `tel:${number}` : null;
}

/** Only a canonical same-origin API reference can enter authenticated transport. */
export function gateIdentityImagePath(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\x00-\x20\x7f\\]/.test(value)) return null;
  try {
    const base = new URL(origin), url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;
    if (!(value.startsWith('/api/v1/') || value.startsWith(`${base.origin}/api/v1/`)) || !url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/api/v1/auth/')) return null;
    // Reject normalized/encoded traversal, separators and double-encoded paths.
    const rawPath = value.startsWith(base.origin) ? value.slice(base.origin.length) : value;
    if (rawPath !== url.pathname || /%|\/\//.test(rawPath) || rawPath.split('/').some(part => part === '.' || part === '..')) return null;
    return url.pathname;
  } catch { return null; }
}

export const GATE_IDENTITY_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export function assertGateIdentityImage(bytes: Uint8Array, mimeType: string): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || bytes.byteLength === 0 || bytes.byteLength > GATE_IDENTITY_IMAGE_MAX_BYTES) throw new Error('This identity photo cannot be displayed.');
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0,4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8,12)) === 'WEBP';
  if (!(mimeType === 'image/png' ? png : mimeType === 'image/jpeg' ? jpeg : webp)) throw new Error('This identity photo cannot be displayed.');
}
export function gateIdentityImageDataUri(bytes: Uint8Array, mimeType: string): string {
  assertGateIdentityImage(bytes, mimeType);
  let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export async function loadGateIdentityImage(options: { reference: unknown; origin: string; assertCurrent(): void; signal: AbortSignal; read(path: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string; assertCurrent(): void }> }): Promise<string> {
  options.assertCurrent(); if (options.signal.aborted) throw new Error('This identity photo request was cancelled.');
  const path = gateIdentityImagePath(options.reference, options.origin); if (!path) throw new Error('No authorized campus photo is available.');
  const image = await options.read(path, options.signal); options.assertCurrent(); image.assertCurrent();
  if (options.signal.aborted) throw new Error('This identity photo request was cancelled.');
  return gateIdentityImageDataUri(image.bytes, image.mimeType);
}
