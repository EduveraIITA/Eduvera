import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { AuthUser } from "../common/request.js";

interface Delegation {
  user: AuthUser;
  requestId: string;
  expiresAt: number;
}

/** One-use in-process identity for an agent call from a verified channel. */
@Injectable()
export class InternalAgentDelegationService {
  private readonly pending = new Map<string, Delegation>();

  issue(user: AuthUser, requestId: string): string {
    this.sweep();
    const token = randomBytes(32).toString("base64url");
    this.pending.set(token, { user: { ...user }, requestId, expiresAt: Date.now() + 15_000 });
    return token;
  }

  consume(token: string): Delegation | null {
    const delegation = this.pending.get(token);
    this.pending.delete(token);
    if (!delegation || delegation.expiresAt <= Date.now()) return null;
    return delegation;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, delegation] of this.pending) if (delegation.expiresAt <= now) this.pending.delete(token);
  }
}
