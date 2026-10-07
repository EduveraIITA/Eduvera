import { Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { RolesService } from "./roles.service.js";
@Controller("api/v1/schools/:schoolId/roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}
  @Get("workspace/") workspace(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string) { return this.roles.workspace(req.authUser,school); }
  @Get("effective/") effective(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string) { return this.roles.effective(req.authUser,school); }
  @Post() create(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string) { return this.roles.save(req.authUser,school,req.body); }
  @Patch(":id/") update(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string,@Param("id") id: string) { return this.roles.save(req.authUser,school,req.body,id); }
  @Post(":id/delete/") remove(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string,@Param("id") id: string) { return this.roles.remove(req.authUser,school,id,req.body); }
  @Post("members/:userId/assignment/") assign(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string,@Param("userId") member: string) { return this.roles.assign(req.authUser,school,member,req.body); }
  @Get("members/:userId/access/") memberAccess(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string,@Param("userId") member: string) { return this.roles.memberAccess(req.authUser,school,member); }
  @Post("members/:userId/exceptions/") addException(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string,@Param("userId") member: string) { return this.roles.addException(req.authUser,school,member,req.body); }
  @Post("exceptions/:id/revoke/") revokeException(@Req() req: AuthenticatedRequest,@Param("schoolId") school: string,@Param("id") id: string) { return this.roles.revokeException(req.authUser,school,id,req.body); }
}
