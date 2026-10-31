import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { AcademicReportsController } from "./academic-reports.controller.js";
import { AcademicReportsService } from "./academic-reports.service.js";

@Module({ imports: [SchoolModule, CampusModelCoreModule], controllers: [AcademicReportsController], providers: [AcademicReportsService] })
export class AcademicReportsModule {}
