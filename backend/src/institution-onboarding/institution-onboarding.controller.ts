import { Controller, Get, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { InstitutionOnboardingService } from "./institution-onboarding.service.js";

@Controller("api/v1/onboarding")
export class InstitutionOnboardingController {
  constructor(private readonly onboarding: InstitutionOnboardingService) {}

  @Get("workspace/")
  workspace(@Req() request: AuthenticatedRequest) {
    return this.onboarding.workspace(request.authUser);
  }

  @Post("institution-applications/")
  submitInstitution(@Req() request: AuthenticatedRequest) {
    return this.onboarding.submitFormal(request.authUser, request.body, request);
  }

  @Post("coaching-workspaces/")
  createCoaching(@Req() request: AuthenticatedRequest) {
    return this.onboarding.createCoaching(request.authUser, request.sessionHash, request.body, request);
  }
}
