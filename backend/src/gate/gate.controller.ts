import type { FastifyReply } from 'fastify';
import type { VisitorPhotoUpload } from './visitor-photo.js';
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
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
 async visitor(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Body() b:unknown) {
  if(!r.isMultipart())return this.service.visitor(r.authUser,s,b);
  const body:Record<string,unknown>={};let upload:VisitorPhotoUpload|undefined;
  for await(const part of r.parts({limits:{fileSize:2*1024*1024,files:1,fields:8}})){
   if(part.type==='file'){
    if(part.fieldname!=='photo'||upload)throw new BadRequestException('Attach one visitor photo.');
    upload={data:await part.toBuffer(),mimetype:part.mimetype};
   }else body[part.fieldname]=part.value;
  }
  return this.service.visitor(r.authUser,s,body,upload);
 }
 @Get("schools/:schoolId/visitors/:id/photo/")
 async photo(@Req() r:AuthenticatedRequest,@Res() reply:FastifyReply,@Param("schoolId") s:string,@Param("id") id:string){
  const photo=await this.service.visitorPhoto(r.authUser,s,id);
  reply.type(photo.type).header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Disposition','inline');
  return reply.send(photo.stream);
 }
 @Post("schools/:schoolId/visitors/:id/:action/")
 visitorAction(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Param("id") id:string,@Param("action") a:string,@Body() b:unknown) {return this.service.visitorAction(r.authUser,s,id,a,b);}
 @Post("schools/:schoolId/visitors/:id/pass/")
 visitorPass(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Param("id") id:string) {return this.service.visitorPass(r.authUser,s,id);}
 @Post("schools/:schoolId/gatekeepers/")
 gatekeeper(@Req() r:AuthenticatedRequest,@Param("schoolId") s:string,@Body() b:unknown) {return this.service.gatekeeper(r.authUser,s,b);}
}
