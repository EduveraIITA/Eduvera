import { Module } from "@nestjs/common";
import { PrincipalInsightsController } from "./principal-insights.controller.js";
import { PrincipalInsightsService } from "./principal-insights.service.js";

@Module({ controllers: [PrincipalInsightsController], providers: [PrincipalInsightsService] })
export class PrincipalInsightsModule {}
