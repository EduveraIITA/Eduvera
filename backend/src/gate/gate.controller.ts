import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { RequirePermission } from "../roles/permissions.js";
import { GateService } from "./gate.service.js";
@Controller("api/v1/gate")
export class GateController {
 constructor(private readonly service:GateService) {}
 @Get("visitor-approvals/")
 approvals(@Req() r:AuthenticatedRequest) {return this.service.approvals(r.authUser);}
 @Get("schools/:schoolId/workspace/") @RequirePermission("gate.manage")
 workspace(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string) {return this.service.workspace(r.authUser,s);}
 @Get("schools/:schoolId/students/") @RequirePermission("gate.manage")
 students(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Query("q") q='') {return this.service.students(r.authUser,s,q);}
 @Get("schools/:schoolId/students/:studentId/") @RequirePermission("gate.manage")
 student(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Param("studentId") id:string) {return this.service.student(r.authUser,s,id);}
 @Post("schools/:schoolId/scan/") @RequirePermission("gate.manage")
 scan(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Body() b:unknown) {return this.service.scan(r.authUser,s,b);}
 @Post("schools/:schoolId/movements/") @RequirePermission("gate.manage")
 movement(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Body() b:unknown) {return this.service.movement(r.authUser,s,b);}
 @Post("schools/:schoolId/passes/")
 pass(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Body() b:unknown) {return this.service.issuePass(r.authUser,s,b);}
 @Post("schools/:schoolId/visitors/") @RequirePermission("gate.manage")
 visitor(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Body() b:unknown) {return this.service.visitor(r.authUser,s,b);}
 @Post("schools/:schoolId/visitors/:id/:action/")
 visitorAction(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Param("id") id:string,@Param("action") a:string,@Body() b:unknown) {return this.service.visitorAction(r.authUser,s,id,a,b);}
 @Post("schools/:schoolId/visitors/:id/pass/")
 visitorPass(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Param("id") id:string) {return this.service.visitorPass(r.authUser,s,id);}
 @Post("schools/:schoolId/gatekeepers/")
 gatekeeper(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Body() b:unknown) {return this.service.gatekeeper(r.authUser,s,b);}
}
