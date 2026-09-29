import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { PUBLIC_ROUTE, SKIP_CSRF } from "../common/decorators.js";
import type { RequestWithContext } from "../common/request.js";
import { AuthService } from "./auth.service.js";

export function signedCookie(request: FastifyRequest, name: string): string | undefined {
  const encoded = request.cookies[name];
  if (!encoded) return undefined;
  const result = request.unsignCookie(encoded);
  return result.valid ? result.value : undefined;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const identity = await this.auth.resolveSession(signedCookie(request, config().SESSION_COOKIE_NAME));
    if (!identity) throw new UnauthorizedException("Authentication credentials were not provided or have expired.");
    request.authUser = identity.user;
    request.sessionHash = identity.tokenHash;
    request.csrfToken = identity.csrfToken;
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
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
