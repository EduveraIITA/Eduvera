var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, Controller, Get, HttpCode, NotFoundException, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { Public, SkipCsrf } from "../common/decorators.js";
import { AuditService } from "../common/audit.service.js";
import { GoogleAuthService } from "./google-auth.service.js";
import { AuthService } from "./auth.service.js";
import { signedCookie } from "./guards.js";
import { demoSwitchRoles } from "./demo-profile-switcher.js";
let AuthController = class AuthController {
    auth;
    audit;
    googleAuth;
    constructor(auth, audit, googleAuth) {
        this.auth = auth;
        this.audit = audit;
        this.googleAuth = googleAuth;
    }
    cookieOptions(httpOnly) {
        return { path: "/", sameSite: "lax", secure: config().COOKIE_SECURE, httpOnly, signed: true, maxAge: config().SESSION_TTL_SECONDS };
    }
    setSession(reply, rawToken, csrfToken) {
        reply.setCookie(config().SESSION_COOKIE_NAME, rawToken, this.cookieOptions(true));
        reply.setCookie("csrftoken", csrfToken, this.cookieOptions(false));
    }
    async csrf(request, reply) {
        const identity = await this.auth.resolveSession(signedCookie(request, config().SESSION_COOKIE_NAME));
        const csrfToken = identity?.csrfToken ?? randomBytes(32).toString("hex");
        reply.setCookie("csrftoken", csrfToken, this.cookieOptions(false));
        return { csrf_token: csrfToken };
    }
    async session(request, reply) {
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
    publicDemoConfig(reply) {
        reply.header("Cache-Control", "no-store");
        return { enabled: config().PUBLIC_DEMO_ENABLED };
    }
    async googleConfig(reply) {
        reply.header("Cache-Control", "no-store");
        if (!config().GOOGLE_CLIENT_ID)
            return { enabled: false };
        const nonce = await this.googleAuth.issueNonce();
        reply.setCookie("google_signin_nonce", nonce, { ...this.cookieOptions(true), maxAge: 600 });
        return { enabled: true, client_id: config().GOOGLE_CLIENT_ID, nonce };
    }
    async googleLogin(request, reply) {
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
    async login(request, reply) {
        const result = await this.auth.login(request.body, request);
        if (result.mfaChallenge) {
            reply.status(202);
            return { mfa_required: true, challenge_token: result.mfaChallenge };
        }
        const session = await this.auth.createSession(result.user, request);
        this.setSession(reply, session.rawToken, session.csrfToken);
        return this.auth.response(result.user, session.csrfToken);
    }
    async mfaLogin(request, reply) {
        const user = await this.auth.completeMfaLogin(request.body, request);
        const session = await this.auth.createSession(user, request);
        this.setSession(reply, session.rawToken, session.csrfToken);
        return this.auth.response(user, session.csrfToken);
    }
    async register(request, reply) {
        const result = await this.auth.register(request.body, request);
        const user = result.user;
        const session = await this.auth.createSession(user, request);
        this.setSession(reply, session.rawToken, session.csrfToken);
        return {
            ...this.auth.response(user, session.csrfToken),
            verification: result.verification,
            onboarding: {
                status: "purpose_required",
                has_school_access: true,
                message: "Your account is ready. Choose what you want ThatCampus to help you run first.",
            },
        };
    }
    requestEmailVerification(request) {
        return this.auth.requestEmailVerification(request.authUser, request);
    }
    confirmEmailVerification(request) {
        return this.auth.confirmEmailVerification(request.authUser, request.body, request);
    }
    passwordResetRequest(request) {
        return this.auth.requestPasswordReset(request.body, request);
    }
    passwordResetConfirm(request) {
        return this.auth.confirmPasswordReset(request.body, request);
    }
    mfaStatus(request) {
        return this.auth.mfaStatus(request.authUser);
    }
    beginMfa(request) {
        return this.auth.beginMfaEnrollment(request.authUser, request);
    }
    confirmMfa(request) {
        return this.auth.confirmMfaEnrollment(request.authUser, request.body, request);
    }
    async demo(request, reply) {
        if (!config().DEMO_MODE || !['development', 'test'].includes(config().DEPLOYMENT_ENVIRONMENT))
            throw new (await import("@nestjs/common")).NotFoundException();
        const role = request.body?.role ?? "student";
        if (!["student", "parent", "staff", "admin", "school_admin", "company"].includes(role))
            throw new (await import("@nestjs/common")).BadRequestException("Unknown demo persona.");
        const user = await this.auth.demoUser(role);
        const session = await this.auth.createSession(user, request);
        this.setSession(reply, session.rawToken, session.csrfToken);
        await this.audit.record({ action: "auth.demo_session.started", request, actorId: user.id, metadata: { persona: role } });
        return this.auth.response(user, session.csrfToken);
    }
    async publicDemo(request, reply) {
        const role = request.body?.role;
        if (!role || !demoSwitchRoles.includes(role))
            throw new BadRequestException("Choose one of the available demo profiles.");
        const user = await this.auth.publicDemoUser(role, request);
        const session = await this.auth.createSession(user, request, { publicDemo: true, ttlSeconds: config().PUBLIC_DEMO_SESSION_TTL_SECONDS });
        this.setSession(reply, session.rawToken, session.csrfToken);
        await this.audit.record({ action: "auth.public_demo.started", request, actorId: user.id, metadata: { persona: role } });
        return { ...this.auth.response(user, session.csrfToken), public_demo: true };
    }
    async demoProfiles(request) {
        const result = await this.auth.demoProfiles(request.authUser);
        if (!result)
            throw new NotFoundException();
        return result;
    }
    async switchDemoProfile(request, reply) {
        if (!this.auth.canUseDemoProfileSwitcher(request.authUser))
            throw new NotFoundException();
        const role = request.body?.role;
        if (!role || !demoSwitchRoles.includes(role))
            throw new BadRequestException("Choose one of the available demo profiles.");
        const target = await this.auth.demoProfile(role);
        if (target.username === request.authUser.username) {
            await this.auth.returnSessionToLive(request.sessionHash);
            return { ...this.auth.response(target, request.csrfToken), redirect_to: this.demoHome(role) };
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
        return { ...this.auth.response(target, session.csrfToken), public_demo: request.publicDemo === true, redirect_to: this.demoHome(role) };
    }
    demoHome(role) {
        void role;
        return "/today";
    }
    async logout(request, reply) {
        const rawToken = signedCookie(request, config().SESSION_COOKIE_NAME);
        reply.clearCookie(config().SESSION_COOKIE_NAME, { path: "/" });
        reply.clearCookie("csrftoken", { path: "/" });
        if (!rawToken)
            return;
        const tokenHash = AuthService.tokenHash(rawToken);
        const identity = await this.auth.resolveSession(rawToken).catch(() => null);
        const work = [this.auth.logout(tokenHash)];
        if (identity) {
            work.push(this.audit.record({ action: "auth.logout", request, actorId: identity.user.id }));
        }
        await Promise.allSettled(work);
    }
    selectSchool(request) { return this.auth.selectSchool(request.authUser, request.sessionHash, request.body); }
    executionEnvironment(request) {
        return this.auth.currentExecutionEnvironment(request.authUser, request.sessionHash);
    }
    selectExecutionEnvironment(request) {
        return this.auth.selectExecutionEnvironment(request.authUser, request.sessionHash, request.body, request);
    }
    sessions(request) { return this.auth.sessions(request.authUser, request.sessionHash); }
    revokeOthers(request) { return this.auth.revokeOtherSessions(request.authUser, request.sessionHash); }
    me(request) {
        return this.auth.me(request.authUser, { allowGuidanceResume: request.executionEnvironmentView.mode !== "simulation"
                && !request.publicDemo && !request.internalAgentDelegation && !request.hostedCampusSimulator }).then(result => ({
            ...result,
            public_demo: request.publicDemo === true,
            execution_environment: request.executionEnvironmentView,
        }));
    }
    proFeatures(request) { return this.auth.proFeatures(request.authUser); }
    setProFeatures(request) { return this.auth.setProFeatures(request.authUser, request.body, request); }
    accountProfile(request) { return this.auth.updateAccountProfile(request); }
};
__decorate([
    Public(),
    Get("csrf/"),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "csrf", null);
__decorate([
    Public(),
    Get("session/"),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "session", null);
__decorate([
    Public(),
    Get("public-demo-config/"),
    __param(0, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "publicDemoConfig", null);
__decorate([
    Public(),
    Get("google/config/"),
    __param(0, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "googleConfig", null);
__decorate([
    Public(),
    Post("google/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "googleLogin", null);
__decorate([
    Public(),
    Post("login/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    Public(),
    Post("mfa/login/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "mfaLogin", null);
__decorate([
    Public(),
    Post("register/"),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    Post("email-verification/request/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "requestEmailVerification", null);
__decorate([
    Post("email-verification/confirm/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "confirmEmailVerification", null);
__decorate([
    Public(),
    Post("password-reset/request/"),
    HttpCode(202),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "passwordResetRequest", null);
__decorate([
    Public(),
    Post("password-reset/confirm/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "passwordResetConfirm", null);
__decorate([
    Get("mfa/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "mfaStatus", null);
__decorate([
    Post("mfa/enroll/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "beginMfa", null);
__decorate([
    Post("mfa/confirm/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "confirmMfa", null);
__decorate([
    Public(),
    SkipCsrf(),
    Post("demo-session/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "demo", null);
__decorate([
    Public(),
    Post("public-demo-session/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "publicDemo", null);
__decorate([
    ApiCookieAuth(),
    Get("demo-profiles/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "demoProfiles", null);
__decorate([
    ApiCookieAuth(),
    Post("demo-profile-switch/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "switchDemoProfile", null);
__decorate([
    Public(),
    SkipCsrf(),
    Post("logout/"),
    HttpCode(204),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    ApiCookieAuth(),
    Post("active-school/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "selectSchool", null);
__decorate([
    ApiCookieAuth(),
    Get("execution-environment/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "executionEnvironment", null);
__decorate([
    ApiCookieAuth(),
    Post("execution-environment/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "selectExecutionEnvironment", null);
__decorate([
    Get("sessions/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "sessions", null);
__decorate([
    Post("sessions/revoke-others/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "revokeOthers", null);
__decorate([
    ApiCookieAuth(),
    Get("me/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "me", null);
__decorate([
    ApiCookieAuth(),
    Get("pro-features/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "proFeatures", null);
__decorate([
    ApiCookieAuth(),
    Post("pro-features/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "setProFeatures", null);
__decorate([
    ApiCookieAuth(),
    Patch("profile/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "accountProfile", null);
AuthController = __decorate([
    ApiTags("authentication"),
    Controller("api/v1/auth"),
    __metadata("design:paramtypes", [AuthService, AuditService, GoogleAuthService])
], AuthController);
export { AuthController };
//# sourceMappingURL=auth.controller.js.map