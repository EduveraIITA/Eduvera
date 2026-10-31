import { browserPickedFileUri, parseBrowserPrivateFileUri } from './browser-private-file-policy';
export function pendingFileUriAllowed(uri: string, scopeKey: string, allowPicked = false) {
  const saved = parseBrowserPrivateFileUri(uri);
  return allowPicked && browserPickedFileUri(uri) || !!saved && saved.kind === 'pending' && saved.scopeKey === scopeKey;
}
export function leaveFileUriAllowed(uri: string, scopeKey: string) {
  const saved = parseBrowserPrivateFileUri(uri); return !!saved && saved.kind === 'leave' && saved.scopeKey === scopeKey;
}
