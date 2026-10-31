export interface NativeGooglePageInput {
  clientId: string;
  oidcNonce: string;
  requestEnvelope: string;
  csrfProof: string;
  scriptNonce: string;
  proofPath: string;
}

const proofPath = "/api/v1/auth/native/google/proof/";

function checkedNonce(value: string): string {
  if (!/^[A-Za-z0-9+/_-]{16,256}={0,2}$/u.test(value)) throw new TypeError("Invalid page script nonce.");
  return value;
}

/** The bridge accepts a one-time handoff only, never arbitrary app navigation. */
export function nativeGoogleCallbackAllowed(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("thatcampus://auth/google?")
    || /[\u0000-\u0020\u007f\\#]/u.test(value)) return false;
  try {
    const callback = new URL(value);
    if (callback.protocol !== "thatcampus:" || callback.hostname !== "auth" || callback.pathname !== "/google"
      || callback.username || callback.password || callback.port || callback.hash) return false;
    const entries = [...callback.searchParams.entries()];
    if (entries.length !== 2 || callback.searchParams.getAll("code").length !== 1
      || callback.searchParams.getAll("state").length !== 1) return false;
    return entries.every(([key, entry]) => (key === "code" || key === "state")
      && entry.trim().length > 0 && !/[\u0000-\u0020\u007f]/u.test(entry));
  } catch {
    return false;
  }
}

/** Applied by the owning controller only to this standalone document. */
export function nativeGoogleBridgeCsp(scriptNonce: string, origin: string): string {
  const nonce = checkedNonce(scriptNonce);
  const parsed = new URL(origin);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin
    || parsed.username || parsed.password) throw new TypeError("Expected the exact API origin.");
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    `script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client`,
    "script-src-attr 'none'",
    `style-src 'nonce-${nonce}' https://accounts.google.com/gsi/style`,
    `connect-src ${origin} https://accounts.google.com/gsi/`,
    "frame-src https://accounts.google.com/gsi/",
    "img-src 'none'",
  ].join("; ");
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function renderNativeGooglePage(input: NativeGooglePageInput): string {
  const nonce = checkedNonce(input.scriptNonce);
  if (input.proofPath !== proofPath) throw new TypeError("Unexpected Google proof endpoint.");
  for (const value of [input.clientId, input.oidcNonce, input.requestEnvelope, input.csrfProof]) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError("Missing Google page configuration.");
  }
  const configuration = safeScriptJson({ clientId: input.clientId, oidcNonce: input.oidcNonce,
    requestEnvelope: input.requestEnvelope, csrfProof: input.csrfProof, proofPath: input.proofPath });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Sign in to ThatCampus</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f2; color: #202a22; }
    main { box-sizing: border-box; width: min(100%, 420px); padding: 32px 24px; }
    .brand { font-weight: 700; color: #28623f; }
    h1 { margin-top: 28px; font-size: 28px; line-height: 1.2; }
    p { line-height: 1.5; }
    #google-button { min-height: 44px; margin: 24px 0; }
    #status { min-height: 48px; }
    .cancel { font-size: 14px; color: #59645b; margin-top: 28px; }
    @media (prefers-color-scheme: dark) { body { background: #182019; color: #eef2ec; } .brand { color: #9dccab; } .cancel { color: #b9c5b9; } }
  </style>
</head>
<body>
  <main>
    <p class="brand">ThatCampus</p>
    <h1>Sign in with Google</h1>
    <p>Choose your Google account to continue to ThatCampus.</p>
    <div id="google-button"></div>
    <p id="status" role="status" aria-live="polite">Loading Google sign-in…</p>
    <p class="cancel">To cancel, close this browser and return to ThatCampus.</p>
    <noscript>JavaScript is required for Google sign-in. Close this browser and choose another sign-in option in ThatCampus.</noscript>
  </main>
  <script id="google-gis" nonce="${nonce}" src="https://accounts.google.com/gsi/client" async defer></script>
  <script nonce="${nonce}">
(() => {
  "use strict";
  const configuration = ${configuration};
  const validCallback = ${nativeGoogleCallbackAllowed.toString()};
  const status = document.getElementById("status");
  const button = document.getElementById("google-button");
  const script = document.getElementById("google-gis");
  let initialized = false;
  let submitted = false;
  const fail = () => {
    button.hidden = true;
    status.textContent = "Google sign-in could not be completed. Close this browser and try again from ThatCampus.";
  };
  const receiveCredential = async (result) => {
    if (submitted) return;
    if (!result || typeof result.credential !== "string" || result.credential.length === 0 || result.credential.length > 16384) {
      fail();
      return;
    }
    submitted = true;
    button.hidden = true;
    status.textContent = "Verifying your Google account…";
    try {
      const response = await fetch(configuration.proofPath, {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: configuration.requestEnvelope, credential: result.credential, csrf: configuration.csrfProof })
      });
      if (!response.ok) { fail(); return; }
      const receipt = await response.json();
      if (!receipt || !validCallback(receipt.redirect_url)) { fail(); return; }
      window.location.replace(receipt.redirect_url);
    } catch { fail(); }
  };
  const initialize = () => {
    if (initialized) return;
    const identity = window.google && window.google.accounts && window.google.accounts.id;
    if (!identity) { fail(); return; }
    initialized = true;
    try {
      identity.initialize({ client_id: configuration.clientId, nonce: configuration.oidcNonce, auto_select: false, callback: receiveCredential });
      identity.renderButton(button, { type: "standard", theme: "outline", size: "large", text: "continue_with" });
      status.textContent = "Choose your Google account to continue.";
    } catch { fail(); }
  };
  script.addEventListener("load", initialize, { once: true });
  script.addEventListener("error", fail, { once: true });
  if (window.google && window.google.accounts && window.google.accounts.id) initialize();
})();
  </script>
</body>
</html>`;
}
