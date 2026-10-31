import type { VisitOnboardingAccountResult, VisitOnboardingJoinResult, VisitOnboardingPreview, VisitOnboardingProof } from '../../../packages/contracts/src/visit-onboarding';

export const visitJoinUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const visitJoinToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (): never => { throw new Error('The visit response could not be verified. Open the original link or try again.'); };
function record(value: unknown, keys: string[]) { if (!object(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key))) return fail(); return value; }
function text(value: unknown, limit = 500) { if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return fail(); return value; }
function uuid(value: unknown) { if (typeof value !== 'string' || !visitJoinUuid.test(value)) return fail(); return value; }
function instant(value: unknown) { const parsed = text(value, 80); if (!Number.isFinite(Date.parse(parsed))) return fail(); return parsed; }

/** The public token is accepted only from one exact fragment field, never a query. */
export function visitJoinFragment(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const fields = new URLSearchParams(value.replace(/^#/, ''));
  const token = fields.get('token');
  return [...fields.keys()].length === 1 && fields.getAll('token').length === 1 && visitJoinToken(token) ? token : null;
}
export function visitJoinReturnTarget(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\/visit-join\?continue=[0-9a-f-]{36}$/i.test(value)) return null;
  const id = value.slice('/visit-join?continue='.length);
  return visitJoinUuid.test(id) ? value : null;
}
export function checkedVisitPreview(value: unknown): VisitOnboardingPreview {
  const data = record(value, ['campus','visit','available_until','authentication_required','timezone']);
  const campus = record(data.campus,['id','name']), visit = record(data.visit,['id','title','starts_at','ends_at','place_label']);
  const starts_at = instant(visit.starts_at), ends_at = instant(visit.ends_at);
  if (data.authentication_required !== true || Date.parse(ends_at) <= Date.parse(starts_at)) return fail();
  const timezone = text(data.timezone,100); try { new Intl.DateTimeFormat('en',{ timeZone: timezone }).format(); } catch { return fail(); }
  return { campus: { id: uuid(campus.id), name: text(campus.name) }, visit: { id: uuid(visit.id), title: text(visit.title), starts_at, ends_at, place_label: text(visit.place_label) }, available_until: instant(data.available_until), authentication_required: true, timezone };
}
export function checkedVisitProof(value: unknown): VisitOnboardingProof {
  const data = record(value,['challenge_id','expires_at','delivery','retry_after_seconds']);
  if (!['email_accepted','unavailable'].includes(String(data.delivery)) || !Number.isSafeInteger(data.retry_after_seconds) || Number(data.retry_after_seconds) < 0 || Number(data.retry_after_seconds) > 3600) return fail();
  return { challenge_id: uuid(data.challenge_id), expires_at: instant(data.expires_at), delivery: data.delivery as VisitOnboardingProof['delivery'], retry_after_seconds: Number(data.retry_after_seconds) };
}
export function checkedVisitAccount(value: unknown): VisitOnboardingAccountResult {
  const data = record(value,['status']);
  if (data.status !== 'created' && data.status !== 'sign_in_required') return fail();
  return { status: data.status };
}
export function checkedVisitJoin(value: unknown, preview: VisitOnboardingPreview): VisitOnboardingJoinResult {
  const data = record(value,['accepted','registration_id','school_id','visit_id','href','replayed']);
  const school = uuid(data.school_id), visit = uuid(data.visit_id), registration = uuid(data.registration_id);
  const href = `/areas/in-out/visits?visit=${encodeURIComponent(visit)}&participant=1`;
  if (data.accepted !== true || typeof data.replayed !== 'boolean' || school !== preview.campus.id || visit !== preview.visit.id || data.href !== href) return fail();
  return { accepted: true, registration_id: registration, school_id: school, visit_id: visit, href, replayed: data.replayed };
}

export type VisitPublicAction = 'preview' | 'proof' | 'account';
export type VisitPublicInput = { token: string; email?: string; challenge_id?: string; code?: string; first_name?: string; last_name?: string; password?: string };
export function visitPublicInput(action: VisitPublicAction, input: unknown): VisitPublicInput {
  const fields = action === 'preview' ? ['token'] : action === 'proof' ? ['token','email'] : action === 'account' ? ['token','email','challenge_id','code','first_name','last_name','password'] : [];
  if (!fields.length) throw new Error('This visit account action is unavailable.');
  const data = record(input, fields); if (!visitJoinToken(data.token)) throw new Error('Open the original visit link before continuing.');
  if (action === 'preview') return { token: data.token };
  if (typeof data.email !== 'string') throw new Error('Enter your email address.');
  const email = data.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (action === 'proof') return { token: data.token, email };
  if (typeof data.code !== 'string' || !/^\d{6}$/.test(data.code) || typeof data.challenge_id !== 'string' || !visitJoinUuid.test(data.challenge_id)) throw new Error('Enter the six-digit code from this email verification request.');
  if (typeof data.first_name !== 'string' || !data.first_name.trim() || data.first_name.trim().length > 150 || typeof data.last_name !== 'string' || data.last_name.trim().length > 150) throw new Error('Enter your name, up to 150 characters per field.');
  if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128 || !/[a-z]/.test(data.password) || !/[A-Z]/.test(data.password) || !/\d/.test(data.password) || !/[^A-Za-z0-9]/.test(data.password)) throw new Error('Use 12–128 characters with upper- and lowercase letters, a number and a symbol.');
  return { token: data.token, email, challenge_id: data.challenge_id, code: data.code, first_name: data.first_name.trim(), last_name: data.last_name.trim(), password: data.password };
}

/** Native URL normalization can discard fragments. Recognize only the exact app
 * entry; return undefined for unrelated links and null for malformed invitations.
 * The caller immediately exchanges the secret for a volatile origin-bound nonce. */
export function visitJoinNativeEntry(path: string): string | null | undefined {
  if (typeof path !== 'string' || path.length > 4096) return undefined;
  let url: URL;
  try { url = new URL(path, 'thatcampus:///'); } catch { return undefined; }
  if (url.protocol !== 'thatcampus:' || !((url.host === 'visit-join' && ['', '/'].includes(url.pathname)) || (!url.host && url.pathname === '/visit-join'))) return undefined;
  if (url.username || url.password || url.port) return null;
  if (!url.hash) return !url.search || visitJoinReturnTarget('/visit-join'+url.search) ? undefined : null;
  if (url.search) return null;
  return visitJoinFragment(url.hash);
}
