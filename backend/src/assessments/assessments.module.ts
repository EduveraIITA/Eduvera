import { Module } from "@nestjs/common";
import { AssessmentsController } from "./assessments.controller.js";
import { AssessmentsService } from "./assessments.service.js";

@Module({ controllers: [AssessmentsController], providers: [AssessmentsService] })
export class AssessmentsModule {}
