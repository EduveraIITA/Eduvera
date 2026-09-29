import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { PhotoAttendanceController } from "./photo-attendance.controller.js";
import { PhotoAttendanceService } from "./photo-attendance.service.js";
import { PhotoAttendanceVisionClient } from "./vision-client.js";

@Module({
  imports: [SchoolModule],
  controllers: [PhotoAttendanceController],
  providers: [PhotoAttendanceService, PhotoAttendanceVisionClient],
  exports: [PhotoAttendanceService],
})
export class PhotoAttendanceModule {}
