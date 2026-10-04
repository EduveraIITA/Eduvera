import { Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { Public, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { AuditService } from "../common/audit.service.js";
import { AuthService } from "./auth.service.js";
import { signedCookie } from "./guards.js";

@ApiTags("authentication")
@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly audit: AuditService) {}

  private cookieOptions(httpOnly: boolean) {
    return { path: "/", sameSite: "lax" as const, secure: config().COOKIE_SECURE, httpOnly, signed: true, maxAge: config().SESSION_TTL_SECONDS };
  }

  private setSession(reply: FastifyReply, rawToken: string, csrfToken: string): void {
    reply.setCookie(config().SESSION_COOKIE_NAME, rawToken, this.cookieOptions(true));
    reply.setCookie("csrftoken", csrfToken, this.cookieOptions(false));
  }

  @Public()
  @Get("csrf/")
  async csrf(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const identity = await this.auth.resolveSession(signedCookie(request, config().SESSION_COOKIE_NAME));
    const csrfToken = identity?.csrfToken ?? randomBytes(32).toString("hex");
    reply.setCookie("csrftoken", csrfToken, this.cookieOptions(false));
    return { csrf_token: csrfToken };
  }

  @Public()
  @Get("session/")
  async session(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const identity = await this.auth.resolveSession(signedCookie(request, config().SESSION_COOKIE_NAME));
    const csrfToken = identity?.csrfToken ?? randomBytes(32).toString("hex");
    reply.setCookie("csrftoken", csrfToken, this.cookieOptions(false));
    return {
      authenticated: Boolean(identity),
      user: identity ? this.auth.response(identity.user, csrfToken).user : null,
      csrf_token: csrfToken,
      demo_mode: config().DEMO_MODE,
    };
  }

  @Public()
  @Post("login/")
  @HttpCode(200)
  async login(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.login(request.body, request);
    if (result.mfaChallenge) {
      reply.status(202);
      return { mfa_required: true, challenge_token: result.mfaChallenge };
    }
    const session = await this.auth.createSession(result.user, request);
    this.setSession(reply, session.rawToken, session.csrfToken);
    return this.auth.response(result.user, session.csrfToken);
  }

  @Public()
  @Post("mfa/login/")
  @HttpCode(200)
  async mfaLogin(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const user = await this.auth.completeMfaLogin(request.body, request);
    const session = await this.auth.createSession(user, request);
    this.setSession(reply, session.rawToken, session.csrfToken);
    return this.auth.response(user, session.csrfToken);
  }

  @Public()
  @Post("register/")
  async register(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.register(request.body, request);
    const user = result.user;
    const session = await this.auth.createSession(user, request);
    this.setSession(reply, session.rawToken, session.csrfToken);
    return {
      ...this.auth.response(user, session.csrfToken),
      verification: result.verification,
      onboarding: {
        status: "pending_school_membership",
        has_school_access: false,
        message: "Your account is ready. Join a school through its invitation or onboarding process to access student data.",
      },
    };
  }

  @Post("email-verification/request/")
  requestEmailVerification(@Req() request: AuthenticatedRequest) {
    return this.auth.requestEmailVerification(request.authUser, request);
  }

  @Post("email-verification/confirm/")
  @HttpCode(200)
  confirmEmailVerification(@Req() request: AuthenticatedRequest) {
    return this.auth.confirmEmailVerification(request.authUser, request.body, request);
  }

  @Public()
  @Post("password-reset/request/")
  @HttpCode(202)
  passwordResetRequest(@Req() request: FastifyRequest) {
    return this.auth.requestPasswordReset(request.body, request);
  }

  @Public()
  @Post("password-reset/confirm/")
  @HttpCode(200)
  passwordResetConfirm(@Req() request: FastifyRequest) {
    return this.auth.confirmPasswordReset(request.body, request);
  }

  @Get("mfa/")
  mfaStatus(@Req() request: AuthenticatedRequest) {
    return this.auth.mfaStatus(request.authUser);
  }

  @Post("mfa/enroll/")
  beginMfa(@Req() request: AuthenticatedRequest) {
    return this.auth.beginMfaEnrollment(request.authUser, request);
  }

  @Post("mfa/confirm/")
  @HttpCode(200)
  confirmMfa(@Req() request: AuthenticatedRequest) {
    return this.auth.confirmMfaEnrollment(request.authUser, request.body, request);
  }

  @Public()
  @SkipCsrf()
  @Post("demo-session/")
  @HttpCode(200)
  async demo(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!config().DEMO_MODE) throw new (await import("@nestjs/common")).NotFoundException();
    const role = (request.body as any)?.role ?? "student";
    if (!["student", "parent", "staff", "admin", "school_admin", "company"].includes(role)) throw new (await import("@nestjs/common")).BadRequestException("Unknown demo persona.");
    const user = await this.auth.demoUser(role);
    const session = await this.auth.createSession(user, request);
    this.setSession(reply, session.rawToken, session.csrfToken);
    await this.audit.record({ action: "auth.demo_session.started", request, actorId: user.id, metadata: { persona: role } });
    return this.auth.response(user, session.csrfToken);
  }

  @Public()
  @SkipCsrf()
  @Post("logout/")
  @HttpCode(204)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const rawToken = signedCookie(request, config().SESSION_COOKIE_NAME);
    reply.clearCookie(config().SESSION_COOKIE_NAME, { path: "/" });
    reply.clearCookie("csrftoken", { path: "/" });
    if (!rawToken) return;

    const tokenHash = AuthService.tokenHash(rawToken);
    const identity = await this.auth.resolveSession(rawToken).catch(() => null);
    const work: Promise<unknown>[] = [this.auth.logout(tokenHash)];
    if (identity) {
      work.push(this.audit.record({ action: "auth.logout", request, actorId: identity.user.id }));
    }
    await Promise.allSettled(work);
  }

  @ApiCookieAuth()
  @Post("active-school/")
  @HttpCode(200)
  selectSchool(@Req() request: AuthenticatedRequest) { return this.auth.selectSchool(request.authUser, request.sessionHash, request.body); }

  @Get("sessions/")
  sessions(@Req() request: AuthenticatedRequest) { return this.auth.sessions(request.authUser, request.sessionHash); }

  @Post("sessions/revoke-others/")
  @HttpCode(200)
  revokeOthers(@Req() request: AuthenticatedRequest) { return this.auth.revokeOtherSessions(request.authUser, request.sessionHash); }

  @ApiCookieAuth()
  @Get("me/")
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.authUser);
  }
}
