import { BadRequestException, Controller, Get, HttpCode, NotFoundException, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { Public, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { AuditService } from "../common/audit.service.js";
import { GoogleAuthService } from "./google-auth.service.js";
import { AuthService } from "./auth.service.js";
import { signedCookie } from "./guards.js";
import { demoSwitchRoles, type DemoSwitchRole } from "./demo-profile-switcher.js";

@ApiTags("authentication")
@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly audit: AuditService, private readonly googleAuth: GoogleAuthService) {}

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
      user: identity ? this.auth.response(identity.user, csrfToken, identity.executionEnvironmentView).user : null,
      csrf_token: csrfToken,
      demo_mode: config().DEMO_MODE,
      demo_profile_switcher: identity ? this.auth.canUseDemoProfileSwitcher(identity.user) : false,
      public_demo: identity?.publicDemo ?? false,
      execution_environment: identity?.executionEnvironmentView ?? { mode: "live", institution_id: null, namespace_id: null },
    };
  }

  @Public()
  @Get("google/config/")
  async googleConfig(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "no-store");
    if (!config().GOOGLE_CLIENT_ID) return { enabled: false };
    const nonce = await this.googleAuth.issueNonce();
    reply.setCookie("google_signin_nonce", nonce, { ...this.cookieOptions(true), maxAge: 600 });
    return { enabled: true, client_id: config().GOOGLE_CLIENT_ID, nonce };
  }

  @Public()
  @Post("google/")
  @HttpCode(200)
  async googleLogin(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const nonce = signedCookie(request, "google_signin_nonce");
    reply.clearCookie("google_signin_nonce", { path: "/" });
    const user = await this.googleAuth.login(request.body, nonce, request);
    const result = await this.auth.finishPrimaryLogin(user, request);
    if (result.mfaChallenge) {
      reply.status(202);
      return { mfa_required: true, challenge_token: result.mfaChallenge };
    }
    const session = await this.auth.createSession(user, request);
    this.setSession(reply, session.rawToken, session.csrfToken);
    return this.auth.response(user, session.csrfToken);
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
    if (!config().DEMO_MODE || !['development', 'test'].includes(config().DEPLOYMENT_ENVIRONMENT)) throw new (await import("@nestjs/common")).NotFoundException();
    const role = (request.body as any)?.role ?? "student";
    if (!["student", "parent", "staff", "admin", "school_admin", "company"].includes(role)) throw new (await import("@nestjs/common")).BadRequestException("Unknown demo persona.");
    const user = await this.auth.demoUser(role);
    const session = await this.auth.createSession(user, request);
    this.setSession(reply, session.rawToken, session.csrfToken);
    await this.audit.record({ action: "auth.demo_session.started", request, actorId: user.id, metadata: { persona: role } });
    return this.auth.response(user, session.csrfToken);
  }

  @Public()
  @Post("public-demo-session/")
  @HttpCode(200)
  async publicDemo(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const role = (request.body as { role?: string } | undefined)?.role;
    if (!role || !demoSwitchRoles.includes(role as DemoSwitchRole)) throw new BadRequestException("Choose one of the available demo profiles.");
    const user = await this.auth.publicDemoUser(role as DemoSwitchRole, request);
    const session = await this.auth.createSession(user, request, { publicDemo: true, ttlSeconds: config().PUBLIC_DEMO_SESSION_TTL_SECONDS });
    this.setSession(reply, session.rawToken, session.csrfToken);
    await this.audit.record({ action: "auth.public_demo.started", request, actorId: user.id, metadata: { persona: role } });
    return { ...this.auth.response(user, session.csrfToken), public_demo: true };
  }

  @ApiCookieAuth()
  @Get("demo-profiles/")
  async demoProfiles(@Req() request: AuthenticatedRequest) {
    const result = await this.auth.demoProfiles(request.authUser);
    if (!result) throw new NotFoundException();
    return result;
  }

  @ApiCookieAuth()
  @Post("demo-profile-switch/")
  @HttpCode(200)
  async switchDemoProfile(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!this.auth.canUseDemoProfileSwitcher(request.authUser)) throw new NotFoundException();
    const role = (request.body as { role?: string } | undefined)?.role;
    if (!role || !demoSwitchRoles.includes(role as DemoSwitchRole)) throw new BadRequestException("Choose one of the available demo profiles.");
    const target = await this.auth.demoProfile(role as DemoSwitchRole);
    if (target.username === request.authUser.username) {
      await this.auth.returnSessionToLive(request.sessionHash);
      return { ...this.auth.response(target, request.csrfToken), redirect_to: this.demoHome(role as DemoSwitchRole) };
    }
    const session = await this.auth.createSession(target, request, request.publicDemo ? { publicDemo: true, ttlSeconds: config().PUBLIC_DEMO_SESSION_TTL_SECONDS } : {});
    await this.auth.logout(request.sessionHash);
    this.setSession(reply, session.rawToken, session.csrfToken);
    await this.audit.record({
      action: "auth.demo_profile.switched",
      request,
      actorId: request.authUser.id,
      targetType: "user",
      targetId: target.id,
      metadata: { from_role: request.authUser.role, to_role: role },
    });
    return { ...this.auth.response(target, session.csrfToken), public_demo: request.publicDemo === true, redirect_to: this.demoHome(role as DemoSwitchRole) };
  }

  private demoHome(role: DemoSwitchRole): string {
    return { student: "/student", parent: "/parent/home", staff: "/teacher", admin: "/principal" }[role];
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

  @ApiCookieAuth()
  @Get("execution-environment/")
  executionEnvironment(@Req() request: AuthenticatedRequest) {
    return this.auth.currentExecutionEnvironment(request.authUser, request.sessionHash);
  }

  @ApiCookieAuth()
  @Post("execution-environment/")
  @HttpCode(200)
  selectExecutionEnvironment(@Req() request: AuthenticatedRequest) {
    return this.auth.selectExecutionEnvironment(
      request.authUser,
      request.sessionHash,
      request.body,
      request,
    );
  }

  @ApiCookieAuth()
  @Post("campus-lab-simulation/")
  @HttpCode(200)
  bindCampusLabSimulation(@Req() request: AuthenticatedRequest) {
    return this.auth.bindCampusLabSimulation(request.authUser, request.sessionHash, request.body);
  }

  @Get("sessions/")
  sessions(@Req() request: AuthenticatedRequest) { return this.auth.sessions(request.authUser, request.sessionHash); }

  @Post("sessions/revoke-others/")
  @HttpCode(200)
  revokeOthers(@Req() request: AuthenticatedRequest) { return this.auth.revokeOtherSessions(request.authUser, request.sessionHash); }

  @ApiCookieAuth()
  @Get("me/")
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.authUser).then(result => ({
      ...result,
      public_demo: request.publicDemo === true,
      execution_environment: request.executionEnvironmentView,
    }));
  }

  @ApiCookieAuth()
  @Get("pro-features/")
  proFeatures(@Req() request: AuthenticatedRequest) { return this.auth.proFeatures(request.authUser); }

  @ApiCookieAuth()
  @Post("pro-features/")
  @HttpCode(200)
  setProFeatures(@Req() request: AuthenticatedRequest) { return this.auth.setProFeatures(request.authUser, request.body, request); }
}
