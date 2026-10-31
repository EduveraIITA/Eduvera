import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LiveAccountControl, Public, SkipCsrf } from "../common/decorators.js";
import { signedCookie } from "./guards.js";
import { NATIVE_GOOGLE_COOKIE, NATIVE_GOOGLE_ROOT, nativeGoogleAuthorizeSchema } from "./native-google-policy.js";
import { nativeGoogleBridgeCsp, renderNativeGooglePage } from "./native-google-page.js";
import { NativeGoogleService } from "./native-google.service.js";

@ApiTags("native Google authentication")
@Controller("api/v1/auth/native/google")
@Public()
@LiveAccountControl()
export class NativeGoogleController {
  constructor(@Inject(NativeGoogleService) private readonly google: NativeGoogleService) {}
  @Get("config/")
  configuration(@Res({ passthrough: true }) reply: FastifyReply) { reply.header("Cache-Control", "private, no-store"); return this.google.configuration(); }
  @SkipCsrf()
  @Post("start/")
  @HttpCode(200)
  start(@Req() request: FastifyRequest) { return this.google.start(request.body); }
  @Get("authorize/")
  async authorize(@Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const value = await this.google.authorize(nativeGoogleAuthorizeSchema.parse(query).request);
    reply.header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer").header("Content-Security-Policy", nativeGoogleBridgeCsp(value.page.scriptNonce, value.context.origin));
    reply.setCookie(NATIVE_GOOGLE_COOKIE, value.cookie, { path: NATIVE_GOOGLE_ROOT, signed: true, httpOnly: true, secure: value.context.secureCookie, sameSite: "lax", maxAge: value.maxAge });
    reply.type("text/html; charset=utf-8"); return renderNativeGooglePage(value.page);
  }
  // This isolated browser ceremony uses its own exact Origin + page/cookie
  // proof. It never rotates or borrows the normal web session's CSRF cookie.
  @SkipCsrf()
  @Post("proof/")
  @HttpCode(200)
  proof(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const cookie = signedCookie(request, NATIVE_GOOGLE_COOKIE);
    reply.clearCookie(NATIVE_GOOGLE_COOKIE, { path: NATIVE_GOOGLE_ROOT });
    reply.header("Cache-Control", "private, no-store");
    return this.google.prove(request.body, cookie, request);
  }
  @SkipCsrf()
  @Post("exchange/")
  @HttpCode(200)
  async exchange(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "private, no-store"); const result = await this.google.exchange(request.body, request);
    if ("mfa_required" in result) reply.status(202);
    return result;
  }
}
