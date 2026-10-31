import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { apiFetch } from '../lib/api';
import { runGoogleNativeFlow } from './google-native-flow';
import { base64UrlBytes } from './google-auth-policy';
export function nativeGoogleSignIn(assertCurrent: () => void) {
  return runGoogleNativeFlow({ assertCurrent,
    request: (path,body) => apiFetch(path,body === undefined ? undefined : { method: 'POST',body: JSON.stringify(body) }),
    async entropy() {
      const random = await Crypto.getRandomBytesAsync(64); assertCurrent();
      const state = base64UrlBytes(random.subarray(0,32)),verifier = base64UrlBytes(random.subarray(32));
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,verifier,{ encoding: Crypto.CryptoEncoding.HEX }); assertCurrent();
      if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('Google sign-in could not prepare a secure proof.');
      return { state,verifier,challenge: base64UrlBytes(Uint8Array.from(hash.match(/../g)!,value => parseInt(value,16))) };
    },
    async open(url,callback) { try { return await WebBrowser.openAuthSessionAsync(url,callback,{ preferEphemeralSession: true }); } catch { throw new Error('The secure Google sign-in browser could not be opened. Try again.'); } },
  });
}
