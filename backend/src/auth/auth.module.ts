import { Module } from "@nestjs/common";
import { AuditService } from "../common/audit.service.js";
import { AuthController } from "./auth.controller.js";
import { GoogleAuthService } from "./google-auth.service.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard, SessionGuard } from "./guards.js";
import { InternalAgentDelegationService } from "./internal-agent-delegation.js";

@Module({
  controllers: [AuthController],
  providers: [GoogleAuthService, AuthService, AuditService, SessionGuard, CsrfGuard, InternalAgentDelegationService],
  exports: [AuthService, AuditService, SessionGuard, CsrfGuard, InternalAgentDelegationService],
})
export class AuthModule {}
