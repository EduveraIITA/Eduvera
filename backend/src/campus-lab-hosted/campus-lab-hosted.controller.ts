import { Controller, Get, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusLabHostedService } from "./campus-lab-hosted.service.js";

@Controller("api/v1/development/campus-simulator")
export class CampusLabHostedController {
  constructor(private readonly service: CampusLabHostedService) {}

  @Get("status")
  status(@Req() request: AuthenticatedRequest) {
    return this.service.status(request);
  }

  @Post("control")
  control(@Req() request: AuthenticatedRequest) {
    return this.service.control(request);
  }
}
