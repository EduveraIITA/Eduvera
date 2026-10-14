import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
export function newGateToken() { return `eduera-gate:${randomBytes(32).toString("base64url")}`; }
export function gateTokenHash(token:string) {
 if(!/^eduera-gate:[A-Za-z0-9_-]{43}$/.test(token)) throw new BadRequestException("Invalid QR pass.");
 return createHash("sha256").update(token).digest("hex");
}
export function assertPassUsable(pass:{expires_at:Date|string;used_at:unknown;revoked_at:unknown},now=Date.now()) {
 if(pass.used_at || pass.revoked_at || new Date(pass.expires_at).getTime()<=now) throw new ConflictException("This QR pass has expired, was cancelled or has already been used.");
}
export function assertGateTransition(previous:string|undefined,direction:string) {
 if(previous===direction || (!previous && direction==='out')) throw new ConflictException("Movement changed. Check the current entry or exit before continuing.");
}
