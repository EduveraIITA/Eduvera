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
import { ForbiddenException, GoneException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Reflector } from "@nestjs/core";
import { config } from "../config.js";
import { LIVE_ACCOUNT_CONTROL, PUBLIC_ROUTE, SKIP_CSRF } from "../common/decorators.js";
import { AuthService } from "./auth.service.js";
import { InternalAgentDelegationService } from "./internal-agent-delegation.js";
import { liveSessionExecutionEnvironment } from "./session-execution-environment.js";
import { nativeSessionToken } from "./session-transport.js";
export function signedCookie(request, name) {
    const encoded = request.cookies?.[name];
    if (!encoded)
        return undefined;
    const result = request.unsignCookie(encoded);
    return result.valid ? result.value : undefined;
}
function sessionCredential(request) {
    const bearer = nativeSessionToken(request);
    if (bearer && request.cookies?.[config().SESSION_COOKIE_NAME])
        throw new UnauthorizedException("Present one session credential at a time.");
    return bearer ? { token: bearer, transport: "bearer" }
        : { token: signedCookie(request, config().SESSION_COOKIE_NAME), transport: "cookie" };
}
let SessionGuard = class SessionGuard {
    reflector;
    auth;
    delegations;
    constructor(reflector, auth, delegations) {
        this.reflector = reflector;
        this.auth = auth;
        this.delegations = delegations;
    }
    async canActivate(context) {
        if (this.reflector.getAllAndOverride(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) {
            if (!this.reflector.getAllAndOverride(LIVE_ACCOUNT_CONTROL, [context.getHandler(), context.getClass()]))
                return true;
            const request = context.switchToHttp().getRequest();
            const credential = sessionCredential(request);
            const rawToken = credential.token;
            if (!rawToken)
                return true;
            const identity = await this.auth.resolveSession(rawToken);
            if (!identity)
                return true;
            // A caller header is not evidence of Live. Even an unavailable selected
            // Simulation must not reach an anonymous-looking credential/mail writer.
            if (identity.executionEnvironmentView.mode === "simulation")
                throw new ForbiddenException("App accounts and invitations are managed in Live. Return to Live before continuing.");
            if (identity.publicDemo)
                throw new ForbiddenException("This public demo is read-only. Sign in with your own account to continue.");
            request.csrfToken = identity.csrfToken;
            request.sessionTransport = credential.transport;
            request.executionEnvironmentView = identity.executionEnvironmentView;
            // Match the server-confirmed Live transport namespace without entering its
            // campus domain scope: this account may be joining a different campus.
            // Authentication/authority still comes from the invitation ceremony.
            request.executionEnvironment = null;
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const simulatorToken = request.headers["x-thatcampus-simulator-token"];
        const simulatorUsername = request.headers["x-thatcampus-simulator-user"];
        if (typeof simulatorToken === "string" || typeof simulatorUsername === "string") {
            const expected = config().CAMPUS_SIMULATOR_SERVICE_TOKEN ?? "";
            const received = typeof simulatorToken === "string" ? simulatorToken : "";
            const validSecret = expected.length >= 32
                && received.length === expected.length
                && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
            if (!validSecret || typeof simulatorUsername !== "string")
                throw new UnauthorizedException("Hosted Campus Lab authentication failed.");
            const user = await this.auth.hostedCampusSimulatorUser(simulatorUsername);
            if (!user)
                throw new UnauthorizedException("Hosted Campus Lab identity is not an active Cambridge fixture user.");
            request.authUser = user;
            request.sessionHash = `campus-lab:${user.id}`;
            request.csrfToken = "hosted-campus-lab";
            request.internalAgentDelegation = true;
            request.hostedCampusSimulator = true;
            const environment = liveSessionExecutionEnvironment(user.active_school_id);
            request.executionEnvironment = environment.environment;
            request.executionEnvironmentView = environment.view;
            return true;
        }
        const internalToken = request.headers["x-omnischool-agent-delegation"];
        if (typeof internalToken === "string") {
            const delegation = this.delegations.consume(internalToken);
            if (!delegation || delegation.requestId !== request.requestId)
                throw new UnauthorizedException("Internal delegation is invalid or expired.");
            request.authUser = delegation.user;
            request.sessionHash = `agent:${delegation.requestId}`;
            request.csrfToken = "internal-agent-delegation";
            request.internalAgentDelegation = true;
            const environment = liveSessionExecutionEnvironment(delegation.user.active_school_id);
            request.executionEnvironment = environment.environment;
            request.executionEnvironmentView = environment.view;
            return true;
        }
        const credential = sessionCredential(request);
        const identity = await this.auth.resolveSession(credential.token);
        if (!identity)
            throw new UnauthorizedException("Authentication credentials were not provided or have expired.");
        request.authUser = identity.user;
        request.sessionHash = identity.tokenHash;
        request.csrfToken = identity.csrfToken;
        request.sessionTransport = credential.transport;
        request.sessionExpiresAt = identity.expiresAt;
        request.publicDemo = identity.publicDemo;
        request.executionEnvironment = identity.executionEnvironment;
        request.executionEnvironmentView = identity.executionEnvironmentView;
        const requestPath = request.url?.split("?", 1)[0] ?? "";
        if (identity.executionEnvironmentView.mode === "simulation"
            && identity.executionEnvironmentView.unavailable === true
            && !requestPath.startsWith("/api/v1/auth/")
            && !/^\/api\/v1\/schools\/[^/]+\/simulation(?:\/|$)/u.test(requestPath)) {
            throw new GoneException({
                message: "This Simulation is unavailable. Return to Live to continue.",
                code: "simulation_environment_unavailable",
                reason: identity.executionEnvironmentView.unavailable_reason,
                run_id: identity.executionEnvironmentView.run_id,
            });
        }
        return true;
    }
};
SessionGuard = __decorate([
    Injectable(),
    __param(0, Inject(Reflector)),
    __metadata("design:paramtypes", [Reflector, AuthService,
        InternalAgentDelegationService])
], SessionGuard);
export { SessionGuard };
let PublicDemoGuard = class PublicDemoGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        if (!request.publicDemo || ["GET", "HEAD", "OPTIONS"].includes(request.method))
            return true;
        const path = request.url.split("?", 1)[0];
        if (path === "/api/v1/auth/demo-profile-switch/" || path === "/api/v1/auth/logout/")
            return true;
        throw new ForbiddenException("This public demo is read-only. Switch profiles to explore another workspace.");
    }
};
PublicDemoGuard = __decorate([
    Injectable()
], PublicDemoGuard);
export { PublicDemoGuard };
let CsrfGuard = class CsrfGuard {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        if (["GET", "HEAD", "OPTIONS"].includes(request.method))
            return true;
        if (request.internalAgentDelegation)
            return true;
        // Set only after SessionGuard resolves an explicitly presented native token.
        // A caller-supplied header alone never disables cookie-session CSRF checks.
        if (request.sessionTransport === "bearer")
            return true;
        if (this.reflector.getAllAndOverride(SKIP_CSRF, [context.getHandler(), context.getClass()]))
            return true;
        const cookie = request.cookies.csrftoken;
        const header = request.headers["x-csrftoken"];
        const unsigned = cookie ? request.unsignCookie(cookie) : { valid: false, value: null };
        if (!cookie || typeof header !== "string" || header !== cookie || !unsigned.valid || !unsigned.value) {
            throw new ForbiddenException("CSRF verification failed. Refresh the session token and retry.");
        }
        if (request.csrfToken && request.csrfToken !== unsigned.value) {
            throw new ForbiddenException("CSRF token does not match the active session.");
        }
        return true;
    }
};
CsrfGuard = __decorate([
    Injectable(),
    __param(0, Inject(Reflector)),
    __metadata("design:paramtypes", [Reflector])
], CsrfGuard);
export { CsrfGuard };
//# sourceMappingURL=guards.js.map