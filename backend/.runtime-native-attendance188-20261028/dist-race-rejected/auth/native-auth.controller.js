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
import { Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuditService } from "../common/audit.service.js";
import { LiveAccountControl, Public, SkipCsrf } from "../common/decorators.js";
import { AuthService } from "./auth.service.js";
/** Another transport for existing accounts, sessions and authority, not another identity store. */
let NativeAuthController = class NativeAuthController {
    auth;
    audit;
    constructor(auth, audit) {
        this.auth = auth;
        this.audit = audit;
    }
    async issueSession(user, request) {
        const session = await this.auth.createSession(user, request, { transport: "native" });
        return {
            ...this.auth.response(user, session.csrfToken),
            access_token: session.rawToken,
            token_type: "Bearer",
            expires_at: session.expiresAt,
        };
    }
    requireNative(request) {
        if (request.sessionTransport !== "bearer")
            throw new UnauthorizedException("A native Bearer session is required.");
    }
    async login(request, reply) {
        const result = await this.auth.login(request.body, request);
        if (result.mfaChallenge) {
            reply.status(202);
            return { mfa_required: true, challenge_token: result.mfaChallenge };
        }
        return this.issueSession(result.user, request);
    }
    async mfaLogin(request) {
        const user = await this.auth.completeMfaLogin(request.body, request);
        return this.issueSession(user, request);
    }
    async register(request) {
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
    session(request) {
        this.requireNative(request);
        return {
            ...this.auth.response(request.authUser, request.csrfToken, request.executionEnvironmentView),
            authenticated: true,
            token_type: "Bearer",
            expires_at: request.sessionExpiresAt,
            public_demo: request.publicDemo === true,
        };
    }
    async logout(request) {
        this.requireNative(request);
        // Report success only after the durable session has been revoked. Audit
        // transport failure cannot restore the revoked credential or hide success.
        await this.auth.logout(request.sessionHash);
        await this.audit.record({ action: "auth.logout", request, actorId: request.authUser.id }).catch(() => undefined);
    }
    passwordResetRequest(request) {
        return this.auth.requestPasswordReset(request.body, request);
    }
    passwordResetConfirm(request) {
        return this.auth.confirmPasswordReset(request.body, request);
    }
};
__decorate([
    Public(),
    LiveAccountControl(),
    SkipCsrf(),
    Post("login/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NativeAuthController.prototype, "login", null);
__decorate([
    Public(),
    LiveAccountControl(),
    SkipCsrf(),
    Post("mfa/login/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NativeAuthController.prototype, "mfaLogin", null);
__decorate([
    Public(),
    LiveAccountControl(),
    SkipCsrf(),
    Post("register/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NativeAuthController.prototype, "register", null);
__decorate([
    Get("session/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], NativeAuthController.prototype, "session", null);
__decorate([
    Post("logout/"),
    HttpCode(204),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NativeAuthController.prototype, "logout", null);
__decorate([
    Public(),
    LiveAccountControl(),
    SkipCsrf(),
    Post("password-reset/request/"),
    HttpCode(202),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], NativeAuthController.prototype, "passwordResetRequest", null);
__decorate([
    Public(),
    LiveAccountControl(),
    SkipCsrf(),
    Post("password-reset/confirm/"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], NativeAuthController.prototype, "passwordResetConfirm", null);
NativeAuthController = __decorate([
    ApiTags("native authentication"),
    ApiBearerAuth("native-session"),
    Controller("api/v1/auth/native"),
    __param(0, Inject(AuthService)),
    __param(1, Inject(AuditService)),
    __metadata("design:paramtypes", [AuthService, AuditService])
], NativeAuthController);
export { NativeAuthController };
//# sourceMappingURL=native-auth.controller.js.map