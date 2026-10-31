const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
export const browserPickedFileUri = (uri: string) => new RegExp(`^thatcampus-picked://${uuid}$`, 'i').test(uri);
export function browserPrivateFileUri(kind: 'pending' | 'leave', id: string, scopeKey: string) {
  if (!new RegExp(`^${uuid}$`, 'i').test(id) || !scopeKey || scopeKey.length > 4096) throw new Error('The exact browser file scope is unavailable.');
  return `thatcampus-file://${kind}/${id}?scope=${encodeURIComponent(scopeKey)}`;
}
export function parseBrowserPrivateFileUri(uri: string) {
  try {
    const value = new URL(uri), kind = value.hostname, id = value.pathname.slice(1), scopeKey = value.searchParams.get('scope');
    if (value.protocol !== 'thatcampus-file:' || !['pending', 'leave'].includes(kind) || value.username || value.password || value.port || value.hash || value.searchParams.getAll('scope').length !== 1 || [...value.searchParams.keys()].some(key => key !== 'scope') || !scopeKey || browserPrivateFileUri(kind as 'pending' | 'leave', id, scopeKey) !== uri) return null;
    return { kind: kind as 'pending' | 'leave', id, scopeKey };
  } catch { return null; }
}
