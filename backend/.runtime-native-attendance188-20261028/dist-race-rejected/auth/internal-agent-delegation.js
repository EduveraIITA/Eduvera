var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
/** One-use in-process identity for an agent call from a verified channel. */
let InternalAgentDelegationService = class InternalAgentDelegationService {
    pending = new Map();
    issue(user, requestId) {
        this.sweep();
        const token = randomBytes(32).toString("base64url");
        this.pending.set(token, { user: { ...user }, requestId, expiresAt: Date.now() + 15_000 });
        return token;
    }
    consume(token) {
        const delegation = this.pending.get(token);
        this.pending.delete(token);
        if (!delegation || delegation.expiresAt <= Date.now())
            return null;
        return delegation;
    }
    sweep() {
        const now = Date.now();
        for (const [token, delegation] of this.pending)
            if (delegation.expiresAt <= now)
                this.pending.delete(token);
    }
};
InternalAgentDelegationService = __decorate([
    Injectable()
], InternalAgentDelegationService);
export { InternalAgentDelegationService };
//# sourceMappingURL=internal-agent-delegation.js.map