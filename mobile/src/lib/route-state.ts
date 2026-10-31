import { canonicalInstitutionHref } from './navigation';
export function nativeRouteHref(section: 'areas' | 'work' | 'more', params: Record<string, string | string[] | undefined>) {
  const parts = params.path ? Array.isArray(params.path) ? params.path : [params.path] : [];
  const path = `/${section}/${parts.map(part => encodeURIComponent(part)).join('/')}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'path' || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  const href = canonicalInstitutionHref(`${path}${search.size ? `?${search}` : ''}`);
  return { path: href.split(/[?#]/)[0]!, href };
}
export function conversationIdFromHref(href: string): string | null {
  const [path, search] = href.split('?'); const query = new URLSearchParams(search);
  const explicit = query.get('conversation') ?? query.get('conversation_id');
  if (explicit) return explicit;
  const parts = path!.split('/').filter(Boolean), index = parts.indexOf('conversations');
  return index >= 0 && parts[index + 1] ? decodeURIComponent(parts[index + 1]!) : null;
}
export function conversationListHref(href: string) {
  const query = new URLSearchParams(href.split('?')[1]);
  for (const key of ['conversation', 'conversation_id', 'message', 'message_id']) query.delete(key);
  return `/areas/messages/conversations${query.size ? `?${query}` : ''}`;
}
