import { Controller, Get, Req, Param } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Public } from "../common/decorators.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { InstitutionsService } from "./institutions.service.js";

@Controller("api/v1/institutions")
export class InstitutionsController {
  constructor(private readonly institutions: InstitutionsService) {}

  // Public catalogue contains institution metadata only, never administrators or student data.
  @Public()
  @Get("search/")
  search(@Req() request: FastifyRequest) { return this.institutions.search(request.query); }

  @Get("operator/")
  async operator(@Req() request: AuthenticatedRequest) {
    await this.institutions.requireOperator(request.authUser.id);
    return { is_company_operator: true };
  }

  @Get(":id/")
  async get(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    await this.institutions.requireOperator(request.authUser.id);
    return this.institutions.get(id);
  }

}
