import { accountActionToken } from './account-recovery';

export type AccountMailPurpose = 'email_verification' | 'password_reset';
const nonce = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pathFor = (purpose: AccountMailPurpose) => purpose === 'password_reset' ? '/reset-password' : '/account/security';

/** Email proof links use fragments. The only navigation value retained is a
 * random nonce: no credentials in router history, browser storage or journals. */
export function createAccountMailLinks(now: () => number = Date.now) {
  const entries = new Map<string, { origin: string; purpose: AccountMailPurpose; token: string; at: number }>();
  return {
    retain(token: string, purpose: AccountMailPurpose, origin: string, randomId: () => string) {
      if (!accountActionToken(token) || new URL(origin).origin !== origin) throw new Error('Open the complete account email link again.');
      for (const [id, entry] of entries) if (now() - entry.at >= 30 * 60_000 || now() < entry.at) entries.delete(id);
      const id = randomId();
      if (!nonce.test(id) || entries.has(id)) throw new Error('The account email link could not be prepared.');
      if (entries.size >= 4) entries.delete(entries.keys().next().value!);
      entries.set(id, { origin, purpose, token: token.trim(), at: now() });
      return { id, href: `${pathFor(purpose)}?continue=${id}` };
    },
    read(id: unknown, purpose: AccountMailPurpose, origin: string): string | null {
      if (typeof id !== 'string' || !nonce.test(id)) return null;
      const entry = entries.get(id);
      return entry?.origin === origin && entry.purpose === purpose && now() >= entry.at && now() - entry.at < 30 * 60_000 ? entry.token : null;
    },
    remove(id: string) { entries.delete(id); },
  };
}
export const accountMailLinks = createAccountMailLinks();

/** Exact route/origin/one-proof grammar. Legacy query links remain readable;
 * mixed, duplicated and malformed proof inputs never pick a value implicitly. */
export function accountMailLinkInput(value: string, expectedOrigin: string): { purpose: AccountMailPurpose; token: string } | null | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  let url: URL;
  try { url = new URL(value, expectedOrigin); } catch { return undefined; }
  let path = url.pathname;
  if (url.protocol === 'thatcampus:' && url.host) path = `/${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  if (!['/account/security', '/more/account/security', '/reset-password'].includes(path)) return undefined;
  if (url.username || url.password || url.port && url.protocol === 'thatcampus:' || !['thatcampus:', 'https:', 'http:'].includes(url.protocol)
    || url.protocol !== 'thatcampus:' && url.origin !== expectedOrigin) return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!url.hash && !url.searchParams.has('token')) return undefined;
  if (url.hash && (url.searchParams.has('token') || [...fragment.keys()].some(key => key !== 'token'))) return null;
  const tokens = (url.hash ? fragment : url.searchParams).getAll('token');
  if (tokens.length !== 1 || !accountActionToken(tokens[0]!)) return null;
  return { purpose: path === '/reset-password' ? 'password_reset' : 'email_verification', token: tokens[0]!.trim() };
}

export function accountMailNativeHref(path: string, origin: string, randomId: () => string): string | undefined {
  const input = accountMailLinkInput(path, origin);
  if (input === undefined) return undefined;
  if (!input) return '/login?account_link=invalid';
  try { return accountMailLinks.retain(input.token, input.purpose, origin, randomId).href; }
  catch { return '/login?account_link=invalid'; }
}
