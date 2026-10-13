import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { AssessmentsController } from "./assessments.controller.js";
import { AssessmentsService } from "./assessments.service.js";

@Module({ imports: [SchoolModule], controllers: [AssessmentsController], providers: [AssessmentsService] })
export class AssessmentsModule {}
