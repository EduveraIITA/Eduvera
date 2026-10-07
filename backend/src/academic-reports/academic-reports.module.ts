import { Module } from "@nestjs/common";
import { AcademicReportsController } from "./academic-reports.controller.js";
import { AcademicReportsService } from "./academic-reports.service.js";

@Module({ controllers: [AcademicReportsController], providers: [AcademicReportsService] })
export class AcademicReportsModule {}
