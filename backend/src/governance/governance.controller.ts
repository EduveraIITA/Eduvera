import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { GovernanceService } from "./governance.service.js";

@Controller("api/v1/schools/:schoolId/governance")
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get("workspace/")
  workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.governance.workspace(req.authUser, schoolId);
  }

  @Patch("profile/")
  profile(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Body() body: unknown) {
    return this.governance.updateProfile(req.authUser, schoolId, body);
  }

  @Post("policies/:code/draft/")
  draft(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("code") code: string, @Body() body: unknown) {
    return this.governance.saveDraft(req.authUser, schoolId, code, body);
  }

  @Post("policy-versions/:versionId/submit/")
  submit(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("versionId") versionId: string, @Body() body: unknown) {
    return this.governance.submitForReview(req.authUser, schoolId, versionId, body);
  }

  @Post("policy-versions/:versionId/review/")
  review(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("versionId") versionId: string, @Body() body: unknown) {
    return this.governance.review(req.authUser, schoolId, versionId, body);
  }

  @Get("policies/")
  policies(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) {
    return this.governance.publishedPolicies(req.authUser, schoolId);
  }

  @Post("policy-versions/:versionId/acknowledgements/")
  acknowledge(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("versionId") versionId: string, @Body() body: unknown) {
    return this.governance.acknowledge(req.authUser, schoolId, versionId, body);
  }
}
