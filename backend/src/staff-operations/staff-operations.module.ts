import { Module } from "@nestjs/common";
import { StaffOperationsController } from "./staff-operations.controller.js";
import { StaffOperationsService } from "./staff-operations.service.js";

@Module({ controllers: [StaffOperationsController], providers: [StaffOperationsService] })
export class StaffOperationsModule {}
