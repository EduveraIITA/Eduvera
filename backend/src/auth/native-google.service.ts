import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { AuthService } from "./auth.service.js";
import { GoogleAuthService } from "./google-auth.service.js";
import { NativeGoogleEnvelope, NATIVE_GOOGLE_GRANT_TTL_MS, NATIVE_GOOGLE_REDIRECT_URI, NATIVE_GOOGLE_REQUEST_TTL_MS, NATIVE_GOOGLE_ROOT, nativeGoogleContext, nativeGoogleDigest, nativeGoogleExchangeSchema, nativeGooglePkceMatches, nativeGoogleProof, nativeGoogleProofSchema, nativeGoogleStartSchema, type NativeGoogleContext, type NativeGooglePayloads } from "./native-google-policy.js";

@Injectable()
export class NativeGoogleService {
  constructor(@Inject(GoogleAuthService) private readonly google: GoogleAuthService, @Inject(AuthService) private readonly auth: AuthService) {}
  private context(): NativeGoogleContext { const value = nativeGoogleContext(config()); if (!value) throw new NotFoundException("Native Google sign-in is unavailable."); return value; }
  configuration() { const context = nativeGoogleContext(config()); return context ? { enabled: true as const, authorization_origin: context.origin } : { enabled: false as const }; }
  private open<K extends keyof NativeGooglePayloads>(token: string, phase: K, context: NativeGoogleContext): NativeGooglePayloads[K] {
    try { return new NativeGoogleEnvelope(context).open(token, phase); } catch { throw new UnauthorizedException("Google sign-in expired or could not be verified. Start again."); }
  }
  async start(body: unknown) {
    const context = this.context(), input = nativeGoogleStartSchema.parse(body), now = Date.now(), nonce = await this.google.issueNonce(), expires = now + NATIVE_GOOGLE_REQUEST_TTL_MS;
    const request = new NativeGoogleEnvelope(context).seal({ v: 1, phase: "request", origin: context.origin, client_id: context.clientId, nonce, state: input.state, code_challenge: input.code_challenge, redirect_uri: input.redirect_uri, issued_at: now, expires_at: expires });
    const url = new URL(`${NATIVE_GOOGLE_ROOT}/authorize/`, context.origin); url.searchParams.set("request", request);
    return { authorization_url: url.href, expires_at: new Date(expires).toISOString() };
  }
  async authorize(rawRequest: unknown) {
    const context = this.context();
    if (typeof rawRequest !== "string") throw new UnauthorizedException("Start Google sign-in again from the app.");
    const request = this.open(rawRequest, "request", context);
    if (!await this.google.hasNonce(request.nonce)) throw new UnauthorizedException("This Google sign-in request expired or was already used.");
    const now = Date.now(), nonce = await this.google.issueNonce(), csrf = nativeGoogleProof(), scriptNonce = nativeGoogleProof();
    const browser = new NativeGoogleEnvelope(context).seal({ v: 1, phase: "browser", origin: context.origin, client_id: context.clientId, request_hash: nativeGoogleDigest(rawRequest), nonce, csrf, issued_at: now, expires_at: request.expires_at });
    return { context, cookie: browser, maxAge: Math.max(1, Math.ceil((request.expires_at - now) / 1000)), page: { clientId: context.clientId, oidcNonce: nonce, requestEnvelope: rawRequest, csrfProof: csrf, scriptNonce, proofPath: `${NATIVE_GOOGLE_ROOT}/proof/` } };
  }
  async prove(body: unknown, browserCookie: string | undefined, request: FastifyRequest) {
    const context = this.context();
    if (request.headers.origin !== context.origin) throw new ForbiddenException("Open this Google sign-in from its original browser page.");
    const input = nativeGoogleProofSchema.parse(body);
    if (!browserCookie) throw new UnauthorizedException("The Google sign-in browser expired. Start again.");
    const browser = this.open(browserCookie, "browser", context), original = this.open(input.request, "request", context);
    if (browser.request_hash !== nativeGoogleDigest(input.request) || browser.csrf !== input.csrf) throw new ForbiddenException("The Google sign-in browser proof does not match this request.");
    // Claim before account/identity effects so concurrent proofs cannot mint
    // multiple grants. Failed primary proof requires a new explicit attempt.
    if (!await this.google.consumeNonce(original.nonce)) throw new UnauthorizedException("This Google sign-in request expired or was already used.");
    const user = await this.google.login({ credential: input.credential }, browser.nonce, request), primary = await this.auth.finishPrimaryLogin(user, request);
    const now = Date.now(), nonce = await this.google.issueNonce(60);
    const code = new NativeGoogleEnvelope(context).seal({ v: 1, phase: "grant", origin: context.origin, client_id: context.clientId, nonce, state: original.state, code_challenge: original.code_challenge, redirect_uri: original.redirect_uri, issued_at: now, expires_at: now + NATIVE_GOOGLE_GRANT_TTL_MS, user_id: user.id, active_school_id: user.active_school_id ?? null, mfa_challenge: primary.mfaChallenge ?? null });
    const callback = new URL(NATIVE_GOOGLE_REDIRECT_URI); callback.searchParams.set("code", code); callback.searchParams.set("state", original.state);
    return { redirect_url: callback.href };
  }
  async exchange(body: unknown, request: FastifyRequest) {
    const context = this.context(), input = nativeGoogleExchangeSchema.parse(body), grant = this.open(input.code, "grant", context);
    if (input.redirect_uri !== grant.redirect_uri || !nativeGooglePkceMatches(input.code_verifier, grant.code_challenge)) throw new UnauthorizedException("The Google sign-in return does not match the app that started it.");
    if (!await this.google.consumeNonce(grant.nonce)) throw new UnauthorizedException("This Google sign-in return expired or was already used. Start again.");
    const user = await this.google.resolveNativeAccount(grant.user_id, grant.active_school_id);
    if (grant.mfa_challenge) return { mfa_required: true as const, challenge_token: grant.mfa_challenge };
    const finalized = await this.auth.finalizeNativeGoogleLogin(user, request);
    if ("mfaChallenge" in finalized) return { mfa_required: true as const, challenge_token: finalized.mfaChallenge };
    const { session } = finalized;
    return { ...this.auth.response(finalized.user, session.csrfToken), access_token: session.rawToken, token_type: "Bearer" as const, expires_at: session.expiresAt };
  }
}
