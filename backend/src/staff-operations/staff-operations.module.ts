import { Module } from "@nestjs/common";
import { StaffOperationsController } from "./staff-operations.controller.js";
import { StaffOperationsService } from "./staff-operations.service.js";
import { AccessRolesService } from "../roles/access-roles.service.js";

@Module({ controllers: [StaffOperationsController], providers: [StaffOperationsService, AccessRolesService] })
export class StaffOperationsModule {}
