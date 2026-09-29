import { Controller,Get,Post,Param,Query,Req,HttpCode } from "@nestjs/common";
import { ApiTags,ApiCookieAuth } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { PeopleService } from "./people.service.js";
import { GuardianAuthorityService } from "./guardian-authority.service.js";
@ApiTags("people") @ApiCookieAuth() @Controller("api/v1/people")
export class PeopleController {
  constructor(private readonly people:PeopleService,private readonly authority:GuardianAuthorityService){}
  @Get("guardian-relationships/:id/leave-authority") authorityDetail(@Req() req:AuthenticatedRequest,@Param("id") id:string,@Query("school_id") schoolId:string){return this.authority.detail(req.authUser,id,schoolId);}
  @Post("guardian-relationships/:id/leave-authority") @HttpCode(200) authorityChange(@Req() req:AuthenticatedRequest,@Param("id") id:string){return this.authority.change(req,id,req.body);}
  @Get("students") list(@Req() req:AuthenticatedRequest,@Query() query:Record<string,string>){return this.people.list(req.authUser,query);}
  @Get("guardians") guardians(@Req() req:AuthenticatedRequest,@Query() query:Record<string,string>){return this.people.guardians(req.authUser,query);}
  @Get("enrollment-options") options(@Req() req:AuthenticatedRequest,@Query("school_id") schoolId:string){return this.people.options(req.authUser,schoolId);}
  @Post("enrollment-reviews") @HttpCode(200) preview(@Req() req:AuthenticatedRequest){return this.people.preview(req,req.body);}
  @Post("enrollment-reviews/:id/commit") @HttpCode(200) commit(@Req() req:AuthenticatedRequest,@Param("id") id:string){return this.people.commit(req,id);}
}
