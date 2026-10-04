import { Global, Module } from "@nestjs/common";
import { RolesController } from "./roles.controller.js";
import { RolesService } from "./roles.service.js";
import { PermissionGuard } from "./permission.guard.js";
@Global()
@Module({controllers:[RolesController],providers:[RolesService,PermissionGuard],exports:[RolesService,PermissionGuard]})
export class RolesModule {}
