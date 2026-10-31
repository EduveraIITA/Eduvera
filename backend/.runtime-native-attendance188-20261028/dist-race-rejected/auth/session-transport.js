import { UnauthorizedException } from "@nestjs/common";
export const NATIVE_SESSION_PREFIX = "tc_native_";
const nativeTokenPattern = /^tc_native_[A-Za-z0-9_-]{43}$/u;
/** Native tokens are explicitly presented credentials, never browser cookies. */
export function nativeSessionToken(request) {
    const header = request.headers.authorization;
    if (header === undefined)
        return undefined;
    const match = typeof header === "string" ? /^Bearer ([^\s]+)$/iu.exec(header) : null;
    if (!match?.[1] || !nativeTokenPattern.test(match[1])) {
        throw new UnauthorizedException("A valid native Bearer session is required.");
    }
    return match[1];
}
//# sourceMappingURL=session-transport.js.map