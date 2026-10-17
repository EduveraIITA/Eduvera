import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { PUBLIC_ROUTE, SKIP_CSRF } from "../common/decorators.js";
import type { RequestWithContext } from "../common/request.js";
import { AuthService } from "./auth.service.js";
import { InternalAgentDelegationService } from "./internal-agent-delegation.js";

export function signedCookie(request: FastifyRequest, name: string): string | undefined {
  const encoded = request.cookies[name];
  if (!encoded) return undefined;
  const result = request.unsignCookie(encoded);
  return result.valid ? result.value : undefined;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, private readonly auth: AuthService,
    private readonly delegations: InternalAgentDelegationService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const simulatorToken = request.headers["x-thatcampus-simulator-token"];
    const simulatorUsername = request.headers["x-thatcampus-simulator-user"];
    if (typeof simulatorToken === "string" || typeof simulatorUsername === "string") {
      const expected = config().CAMPUS_SIMULATOR_SERVICE_TOKEN ?? "";
      const received = typeof simulatorToken === "string" ? simulatorToken : "";
      const validSecret = expected.length >= 32
        && received.length === expected.length
        && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
      if (!validSecret || typeof simulatorUsername !== "string") throw new UnauthorizedException("Hosted Campus Lab authentication failed.");
      const user = await this.auth.hostedCampusSimulatorUser(simulatorUsername);
      if (!user) throw new UnauthorizedException("Hosted Campus Lab identity is not an active Cambridge fixture user.");
      request.authUser = user;
      request.sessionHash = `campus-lab:${user.id}`;
      request.csrfToken = "hosted-campus-lab";
      request.internalAgentDelegation = true;
      request.hostedCampusSimulator = true;
      return true;
    }
    const internalToken = request.headers["x-omnischool-agent-delegation"];
    if (typeof internalToken === "string") {
      const delegation = this.delegations.consume(internalToken);
      if (!delegation || delegation.requestId !== request.requestId) throw new UnauthorizedException("Internal delegation is invalid or expired.");
      request.authUser = delegation.user;
      request.sessionHash = `agent:${delegation.requestId}`;
      request.csrfToken = "internal-agent-delegation";
      request.internalAgentDelegation = true;
      return true;
    }
    const identity = await this.auth.resolveSession(signedCookie(request, config().SESSION_COOKIE_NAME));
    if (!identity) throw new UnauthorizedException("Authentication credentials were not provided or have expired.");
    request.authUser = identity.user;
    request.sessionHash = identity.tokenHash;
    request.csrfToken = identity.csrfToken;
    request.publicDemo = identity.publicDemo;
    return true;
  }
}

@Injectable()
export class PublicDemoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.publicDemo || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const path = request.url.split("?", 1)[0];
    if (path === "/api/v1/auth/demo-profile-switch/" || path === "/api/v1/auth/logout/") return true;
    throw new ForbiddenException("This public demo is read-only. Switch profiles to explore another workspace.");
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    if (request.internalAgentDelegation) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;
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
}
