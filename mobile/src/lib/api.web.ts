import { createCampusApiClient } from './api-client';
import { createBrowserDownloadAdapter } from './browser-private-download';
import { browserCsrfToken } from '../auth/web-session-policy';

export { ApiError } from './api-client';
// Cookie authentication deliberately follows this site's /api proxy. A native
// EXPO_PUBLIC_API_URL must never redirect a browser credential to another origin.
const client = createCampusApiClient({ origin: typeof window === 'undefined' ? 'https://invalid.invalid' : window.location.origin, development: __DEV__,
  cookieSession: { readCsrfToken: () => typeof document === 'undefined' ? null : browserCsrfToken(document.cookie) },
});
export const getApiOrigin = client.getApiOrigin;
export const setApiOrigin = client.setApiOrigin;
export const setApiCallbacks = client.setApiCallbacks;
export const blockApiRequests = client.blockApiRequests;
export const bindApiSession = client.bindApiSession;
export const bindCookieSession = client.bindCookieSession;
export const captureApiContext = client.captureApiContext;
export const apiFetch = client.apiFetch;
export const readCampusImage = client.readCampusImage;
export const readGateIdentityImage = client.readGateIdentityImage;
export const readCurrentSession = <T,>() => apiFetch<T>('/api/v1/auth/session/');

/** Bounded private bytes become a short-lived Blob download, never browser storage. */
export function downloadCampusFile(path: string, filename: string): Promise<void> {
  return client.downloadCampusFile(path, filename, createBrowserDownloadAdapter());
}
