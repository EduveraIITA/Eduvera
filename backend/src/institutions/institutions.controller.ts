import { Controller, Get, Post, Req, Param } from "@nestjs/common";
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

  @Post("/")
  async create(@Req() request: AuthenticatedRequest) {
    await this.institutions.requireOperator(request.authUser.id);
    return this.institutions.create(request.authUser.id, request.body);
  }

  @Post("accept-invitation/")
  accept(@Req() request: AuthenticatedRequest) { return this.institutions.accept(request.authUser.id, request.body); }

  @Get(":id/")
  async get(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    await this.institutions.requireOperator(request.authUser.id);
    return this.institutions.get(id);
  }

  @Post(":id/admin-invitations/")
  async invite(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    await this.institutions.requireOperator(request.authUser.id);
    return this.institutions.invite(request.authUser.id, id, request.body);
  }
}
