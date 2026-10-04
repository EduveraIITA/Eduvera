import {Controller,Get,Post,Param,Query,Req,Res,HttpCode} from "@nestjs/common";
import {ApiCookieAuth,ApiTags} from "@nestjs/swagger";
import type {FastifyReply} from "fastify";
import type {AuthenticatedRequest} from "../common/request.js";
import {PeopleImportService} from "./people-import.service.js";
@ApiTags("people imports") @ApiCookieAuth() @Controller("api/v1/people/imports")
export class PeopleImportController {
  constructor(private readonly imports:PeopleImportService){}
  @Get() list(@Req() req:AuthenticatedRequest,@Query() query:Record<string,string>){return this.imports.list(req.authUser,query);}
  @Post() @HttpCode(200) stage(@Req() req:AuthenticatedRequest){return this.imports.stage(req,req.body);}
  @Get("template") async template(@Req() req:AuthenticatedRequest,@Query("school_id") schoolId:string,@Res() reply:FastifyReply){const csv=await this.imports.template(req.authUser,schoolId);return reply.header("Content-Type","text/csv; charset=utf-8").header("Content-Disposition",'attachment; filename="student-import-template.csv"').header("Cache-Control","no-store").send(csv);}
  @Get(":id") detail(@Req() req:AuthenticatedRequest,@Param("id") id:string,@Query("school_id") schoolId:string){return this.imports.detail(req.authUser,id,schoolId);}
  @Post(":id/rows/:row") @HttpCode(200) row(@Req() req:AuthenticatedRequest,@Param("id") id:string,@Param("row") row:string){return this.imports.updateRow(req,id,Number(row),req.body);}
  @Post(":id/commit") @HttpCode(200) commit(@Req() req:AuthenticatedRequest,@Param("id") id:string){return this.imports.commit(req,id,req.body);}
  @Post(":id/cancel") @HttpCode(200) cancel(@Req() req:AuthenticatedRequest,@Param("id") id:string){return this.imports.cancel(req,id,req.body);}
  @Get(":id/report") async report(@Req() req:AuthenticatedRequest,@Param("id") id:string,@Query("school_id") schoolId:string,@Res() reply:FastifyReply){const csv=await this.imports.report(req.authUser,id,schoolId);return reply.header("Content-Type","text/csv; charset=utf-8").header("Content-Disposition",'attachment; filename="student-import-report.csv"').header("Cache-Control","no-store").send(csv);}
}
