import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { AcademicReportsController } from "./academic-reports.controller.js";
import { AcademicReportsService } from "./academic-reports.service.js";

@Module({ imports: [SchoolModule], controllers: [AcademicReportsController], providers: [AcademicReportsService] })
export class AcademicReportsModule {}
