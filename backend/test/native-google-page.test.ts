import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { nativeGoogleBridgeCsp, nativeGoogleCallbackAllowed, renderNativeGooglePage, type NativeGooglePageInput } from "../src/auth/native-google-page.js";

const input: NativeGooglePageInput = { clientId: "configured-client.apps.googleusercontent.com", oidcNonce: "oidc-nonce",
  requestEnvelope: "opaque-request", csrfProof: "browser-proof", scriptNonce: "aBcDeFgHiJkLmNoP123456789_-", proofPath: "/api/v1/auth/native/google/proof/" };
const callback = "thatcampus://auth/google?code=single-use-code&state=app-state";

function pageHarness(pageInput = input, response: unknown = { redirect_url: callback }, ok = true) {
  const html = renderNativeGooglePage(pageInput);
  const source = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(html)?.[1];
  if (!source) throw new Error("Missing bridge script.");
  const status = { textContent: "" };
  const button = { hidden: false };
  const listeners = new Map<string, () => void>();
  const script = { addEventListener: (name: string, listener: () => void) => { listeners.set(name, listener); } };
  let onCredential: ((value: unknown) => Promise<void>) | undefined;
  const initialize = vi.fn((options: { callback: typeof onCredential }) => { onCredential = options.callback; });
  const renderButton = vi.fn();
  const replace = vi.fn();
  const fetch = vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(response) });
  runInNewContext(source, {
    URL, fetch,
    document: { getElementById: (id: string) => ({ status, "google-button": button, "google-gis": script })[id] },
    window: { google: { accounts: { id: { initialize, renderButton } } }, location: { replace } },
  });
  return { html, initialize, renderButton, replace, fetch, status, button, listeners,
    credential: async (value: unknown) => { if (!onCredential) throw new Error("Google was not initialized."); await onCredential(value); } };
}

describe("standalone native Google bridge", () => {
  it("initializes real GIS with the server nonce and posts only to its owning same-origin proof endpoint", async () => {
    const page = pageHarness();
    expect(page.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: input.clientId, nonce: input.oidcNonce, auto_select: false }));
    expect(page.renderButton).toHaveBeenCalledOnce();
    page.listeners.get("load")?.();
    expect(page.initialize).toHaveBeenCalledOnce();
    await page.credential({ credential: "synthetic-id-token" });
    expect(page.fetch).toHaveBeenCalledWith(input.proofPath, expect.objectContaining({ method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store" }));
    expect(JSON.parse(page.fetch.mock.calls[0]?.[1].body)).toEqual({ request: input.requestEnvelope, credential: "synthetic-id-token", csrf: input.csrfProof });
    expect(page.replace).toHaveBeenCalledWith(callback);
    await page.credential({ credential: "another-token" });
    expect(page.fetch).toHaveBeenCalledOnce();
    expect(page.html).toContain("To cancel, close this browser");
  });

  it("escapes script-breaking and Unicode line separator input without changing the posted opaque proof", async () => {
    const dangerous = "</script><script>globalThis.compromised=true</script>&\u2028\u2029";
    const page = pageHarness({ ...input, clientId: dangerous, oidcNonce: dangerous, requestEnvelope: dangerous, csrfProof: dangerous });
    expect(page.html).not.toContain(dangerous);
    expect(page.html.match(/<script\b/gu)).toHaveLength(2);
    expect(page.html).toContain("\\u003c/script\\u003e");
    expect(page.html).toContain("\\u2028\\u2029");
    await page.credential({ credential: "synthetic-id-token" });
    expect(JSON.parse(page.fetch.mock.calls[0]?.[1].body)).toMatchObject({ request: dangerous, csrf: dangerous });
  });

  it.each(["https://evil.test/proof", "//evil.test/proof", "/api/v1/auth/native/google/proof/?next=evil", "/api/v1/auth/native/google/proof/#fragment",
    "/api/v1/auth/native/google/proof%2f", "/api/v1/auth/native/google/other/", "/api/v1/auth/native/google\\proof/"])("refuses a substituted proof endpoint %j", proofPath => {
    expect(() => renderNativeGooglePage({ ...input, proofPath })).toThrow(/endpoint/u);
  });

  it.each([null, {}, { redirect_url: "https://evil.test/" }, { redirect_url: `${callback}&access_token=secret` }, { redirect_url: `${callback}#secret` }])("shows recovery without navigating for malformed proof receipt %j", async response => {
    const page = pageHarness(input, response);
    await page.credential({ credential: "synthetic-id-token" });
    expect(page.replace).not.toHaveBeenCalled();
    expect(page.status.textContent).toContain("Close this browser");
    expect(page.button.hidden).toBe(true);
  });

  it("keeps a failed/unknown send from automatically replaying a Google credential", async () => {
    const page = pageHarness();
    page.fetch.mockRejectedValueOnce(new Error("network interruption"));
    await page.credential({ credential: "synthetic-id-token" });
    await page.credential({ credential: "synthetic-id-token" });
    expect(page.fetch).toHaveBeenCalledOnce();
    expect(page.replace).not.toHaveBeenCalled();
    expect(page.status.textContent).toContain("try again from ThatCampus");
  });

  it("does not navigate on a non-success proof response even if its body contains a callback", async () => {
    const page = pageHarness(input, { redirect_url: callback }, false);
    await page.credential({ credential: "synthetic-id-token" });
    expect(page.replace).not.toHaveBeenCalled();
  });

  it.each([null, {}, { credential: "" }, { credential: "x".repeat(16385) }])("does not send malformed GIS credential %j", async credential => {
    const page = pageHarness();
    await page.credential(credential);
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.replace).not.toHaveBeenCalled();
  });
});

describe("native Google callback boundary", () => {
  it("accepts exactly one code/state pair, in either order", () => {
    expect(nativeGoogleCallbackAllowed(callback)).toBe(true);
    expect(nativeGoogleCallbackAllowed("thatcampus://auth/google?state=state&code=code")).toBe(true);
  });
  it.each([undefined, null, {}, "https://auth/google?code=c&state=s", "thatcampus://evil/google?code=c&state=s",
    "THATCAMPUS://auth/google?code=c&state=s", "thatcampus://auth/google/?code=c&state=s", "thatcampus://auth/%67oogle?code=c&state=s",
    "thatcampus://user@auth/google?code=c&state=s", "thatcampus://auth:123/google?code=c&state=s", "thatcampus://auth/google?code=&state=s",
    "thatcampus://auth/google?code=c&state=", "thatcampus://auth/google?code=c&state=s&state=s", "thatcampus://auth/google?code=c&code=c&state=s",
    "thatcampus://auth/google?code=c&state=s&next=/today", "thatcampus://auth/google?code=c&state=s#", "thatcampus://auth/google?code=%00&state=s",
    "thatcampus://auth/google?code=c&state=%20", " thatcampus://auth/google?code=c&state=s", "thatcampus://auth/google?code=c&state=s\n"])("rejects noncanonical or augmented callback %j", value => {
    expect(nativeGoogleCallbackAllowed(value)).toBe(false);
  });
});

describe("native Google bridge document CSP", () => {
  it("limits the document to its nonced code/styles, own API origin and GIS paths", () => {
    const policy = nativeGoogleBridgeCsp(input.scriptNonce, "https://campus.example.test");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`script-src 'nonce-${input.scriptNonce}' https://accounts.google.com/gsi/client`);
    expect(policy).toContain(`style-src 'nonce-${input.scriptNonce}' https://accounts.google.com/gsi/style`);
    expect(policy).toContain("connect-src https://campus.example.test https://accounts.google.com/gsi/");
    expect(policy).toContain("frame-src https://accounts.google.com/gsi/");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*/u);
    expect(nativeGoogleBridgeCsp(input.scriptNonce, "http://127.0.0.1:8000")).toContain("connect-src http://127.0.0.1:8000 ");
  });
  it.each(["https://campus.example.test/", "https://campus.example.test/path", "https://user@campus.example.test", "https://campus.example.test?x=1",
    "javascript:alert(1)", "https://campus.example.test\r\nscript-src *"])("refuses a non-origin CSP source %j", origin => {
    expect(() => nativeGoogleBridgeCsp(input.scriptNonce, origin)).toThrow();
  });
  it("refuses a nonce that could escape its HTML attribute or CSP directive", () => {
    const malicious = "valid-nonce-value'; script-src *";
    expect(() => nativeGoogleBridgeCsp(malicious, "https://campus.example.test")).toThrow(/nonce/u);
    expect(() => renderNativeGooglePage({ ...input, scriptNonce: '\" onload=\"alert(1)' })).toThrow(/nonce/u);
  });
});
