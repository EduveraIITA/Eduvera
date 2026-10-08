import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { AnalyticsController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";

@Module({ imports: [SchoolModule], controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
