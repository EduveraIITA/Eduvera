export const GOOGLE_NATIVE_CALLBACK = 'thatcampus://auth/google';
export const GOOGLE_BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
export interface GoogleLoginOptions { returnHref: string; assertCurrent(): void }
export function base64UrlBytes(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; let value = '',bits = 0,buffer = 0;
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 6) { bits -= 6; value += alphabet[(buffer >>> bits) & 63]; } }
  if (bits) value += alphabet[(buffer << (6-bits)) & 63]; return value;
}
export function googleCredential(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 16384 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new Error('Google did not return a valid sign-in proof. Start again.');
  return value;
}
export function googleWebConfiguration(value: unknown): { enabled: false } | { enabled: true; clientId: string; nonce: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Google sign-in configuration could not be verified.');
  const row = value as Record<string,unknown>;
  if (row.enabled === false) return { enabled: false };
  if (row.enabled !== true || typeof row.client_id !== 'string' || !/^[A-Za-z0-9_-]{3,200}\.apps\.googleusercontent\.com$/.test(row.client_id) || typeof row.nonce !== 'string' || !GOOGLE_BASE64URL_32.test(row.nonce)) throw new Error('Google sign-in configuration could not be verified.');
  return { enabled: true,clientId: row.client_id,nonce: row.nonce };
}
