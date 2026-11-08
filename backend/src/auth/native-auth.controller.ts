import { BadRequestException, Controller, Get, HttpCode, Inject, NotFoundException, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuditService } from "../common/audit.service.js";
import { LiveAccountControl, Public, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { AuthService } from "./auth.service.js";
import { config } from "../config.js";
import { demoSwitchRoles, type DemoSwitchRole } from "./demo-profile-switcher.js";

/** Another transport for existing accounts, sessions and authority, not another identity store. */
@ApiTags("native authentication")
@ApiBearerAuth("native-session")
@Controller("api/v1/auth/native")
export class NativeAuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(AuditService) private readonly audit: AuditService) {}

  private async issueSession(user: AuthUser, request: FastifyRequest) {
    const session = await this.auth.createSession(user, request, { transport: "native" });
    return {
      ...this.auth.response(user, session.csrfToken),
      access_token: session.rawToken,
      token_type: "Bearer" as const,
      expires_at: session.expiresAt,
    };
  }

  private requireNative(request: AuthenticatedRequest) {
    if (request.sessionTransport !== "bearer")
      throw new UnauthorizedException("A native Bearer session is required.");
  }

  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("login/")
  @HttpCode(200)
  async login(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.login(request.body, request);
    if (result.mfaChallenge) {
      reply.status(202);
      return { mfa_required: true, challenge_token: result.mfaChallenge };
    }
    return this.issueSession(result.user, request);
  }

  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("mfa/login/")
  @HttpCode(200)
  async mfaLogin(@Req() request: FastifyRequest) {
    const { user, session } = await this.auth.completeMfaLogin(request.body, request, { transport: 'native' });
    return { ...this.auth.response(user, session.csrfToken), access_token: session.rawToken,
      token_type: 'Bearer' as const, expires_at: session.expiresAt };
  }

  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("register/")
  async register(@Req() request: FastifyRequest) {
    const { user, verification } = await this.auth.register(request.body, request);
    return {
      ...await this.issueSession(user, request),
      verification,
      onboarding: {
        status: "purpose_required",
        has_school_access: true,
        message: "Your account is ready. Choose what you want ThatCampus to help you run first.",
      },
    };
  }

  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("public-demo-session/")
  @HttpCode(200)
  async publicDemo(@Req() request: FastifyRequest) {
    const role = (request.body as { role?: string } | undefined)?.role;
    if (!role || !demoSwitchRoles.includes(role as DemoSwitchRole)) throw new BadRequestException("Choose one of the available demo profiles.");
    // The owning service enforces configured availability and synthetic actors.
    // Read-only is a durable server session property, never a client preference.
    const user = await this.auth.publicDemoUser(role as DemoSwitchRole, request);
    const session = await this.auth.createSession(user, request, { transport: "native", publicDemo: true, ttlSeconds: config().PUBLIC_DEMO_SESSION_TTL_SECONDS });
    await this.audit.record({ action: "auth.public_demo.started", request, actorId: user.id, metadata: { persona: role } });
    return { ...this.auth.response(user, session.csrfToken), access_token: session.rawToken, token_type: "Bearer" as const, expires_at: session.expiresAt, public_demo: true };
  }

  @Get("session/")
  session(@Req() request: AuthenticatedRequest) {
    this.requireNative(request);
    return {
      ...this.auth.response(request.authUser, request.csrfToken, request.executionEnvironmentView),
      authenticated: true,
      token_type: "Bearer" as const,
      expires_at: request.sessionExpiresAt,
      public_demo: request.publicDemo === true,
    };
  }

  @LiveAccountControl()
  @SkipCsrf()
  @Post("demo-profile-switch/")
  @HttpCode(200)
  async switchDemoProfile(@Req() request: AuthenticatedRequest) {
    this.requireNative(request);
    if (!this.auth.canUseDemoProfileSwitcher(request.authUser)) throw new NotFoundException();
    const role = (request.body as { role?: string } | undefined)?.role;
    if (!role || !demoSwitchRoles.includes(role as DemoSwitchRole)) throw new BadRequestException("Choose one of the available demo profiles.");
    const target = await this.auth.demoProfile(role as DemoSwitchRole);
    if (target.username === request.authUser.username) {
      // Match the web ceremony: choosing the current profile returns its existing
      // session to Live. No raw credential is recovered from the stored hash.
      await this.auth.returnSessionToLive(request.sessionHash);
      return { ...this.auth.response(target, request.csrfToken), session_retained: true,
        token_type: "Bearer" as const, expires_at: request.sessionExpiresAt,
        public_demo: request.publicDemo === true, redirect_to: "/today" };
    }
    const session = await this.auth.createSession(target, request, {
      transport: "native", ...(request.publicDemo ? { publicDemo: true, ttlSeconds: config().PUBLIC_DEMO_SESSION_TTL_SECONDS } : {}),
    });
    await this.auth.logout(request.sessionHash);
    await this.audit.record({ action: "auth.demo_profile.switched", request, actorId: request.authUser.id,
      targetType: "user", targetId: target.id, metadata: { from_role: request.authUser.role, to_role: role } });
    return { ...this.auth.response(target, session.csrfToken), access_token: session.rawToken,
      token_type: "Bearer" as const, expires_at: session.expiresAt,
      public_demo: request.publicDemo === true, redirect_to: "/today" };
  }

  @Post("logout/")
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    this.requireNative(request);
    // Report success only after the durable session has been revoked. Audit
    // transport failure cannot restore the revoked credential or hide success.
    await this.auth.logout(request.sessionHash);
    await this.audit.record({ action: "auth.logout", request, actorId: request.authUser.id }).catch(() => undefined);
  }

  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("password-reset/request/")
  @HttpCode(202)
  passwordResetRequest(@Req() request: FastifyRequest) {
    return this.auth.requestPasswordReset(request.body, request);
  }

  @Public()
  @LiveAccountControl()
  @SkipCsrf()
  @Post("password-reset/confirm/")
  @HttpCode(200)
  passwordResetConfirm(@Req() request: FastifyRequest) {
    return this.auth.confirmPasswordReset(request.body, request);
  }
}
