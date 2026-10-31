import { BadRequestException,Controller,Get,Post,Param,Query,Req,Res,HttpCode } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../common/request.js';
import { attachmentContentDisposition } from '../common/attachment-headers.js';
import type { RepairPhotoUpload } from './facilities-artifacts.js';
import { FacilitiesService } from './facilities.service.js';
@Controller('api/v1/schools/:schoolId/facilities')
export class FacilitiesController {
 constructor(private readonly facilities:FacilitiesService){}
 @Get('workspace') workspace(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Query() query:Record<string,string>){return this.facilities.workspace(req.authUser,school,query);}
 @Get('options') options(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Query() query:Record<string,string>){return this.facilities.options(req.authUser,school,query);}
 @Get('settings') settings(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string){return this.facilities.settings(req.authUser,school);}
 @Post('settings') @HttpCode(200) saveSettings(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string){return this.facilities.saveSettings(req.authUser,school,req.body);}
 @Get('settings/confirmation') settingsConfirmation(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Query('command_id') command:string){return this.facilities.confirmation(req.authUser,school,school,z.uuid().parse(command),true);}
 @Post('repairs') @HttpCode(200) report(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string){return this.facilities.report(req.authUser,school,req.body);}
 @Get('repairs/:id') detail(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Query() query:Record<string,string>){return this.facilities.detail(req.authUser,school,z.uuid().parse(id),query);}
 @Get('repairs/:id/confirmation') confirmation(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Query('command_id') command:string){return this.facilities.confirmation(req.authUser,school,z.uuid().parse(id),z.uuid().parse(command));}
 @Post('repairs/:id/actions') @HttpCode(200) act(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.facilities.act(req.authUser,school,z.uuid().parse(id),req.body);}
 @Post('repairs/:id/external-access') @HttpCode(200) grantExternal(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.facilities.grantExternal(req.authUser,school,z.uuid().parse(id),req.body);}
 @Post('repairs/:id/external-access/:assignmentId/activate') @HttpCode(200) activateExternal(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Param('assignmentId') assignmentId:string){return this.facilities.activateExternal(req.authUser,school,z.uuid().parse(id),z.uuid().parse(assignmentId),req.body);}
 @Post('repairs/:id/external-access/:assignmentId/end') @HttpCode(200) endExternal(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Param('assignmentId') assignmentId:string){return this.facilities.endExternal(req.authUser,school,z.uuid().parse(id),z.uuid().parse(assignmentId),req.body);}
 @Post('repairs/:id/photos') @HttpCode(200) async addPhoto(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){
  if(!req.isMultipart())throw new BadRequestException('Choose one repair photo using multipart form data.');const body:Record<string,unknown>={};let upload:RepairPhotoUpload|undefined;
  for await(const part of req.parts({limits:{files:1,fields:2,fileSize:5*1024*1024}})){
   if(part.type==='file'){if(part.fieldname!=='file'||upload)throw new BadRequestException('Choose one repair photo.');const data=await part.toBuffer();if(part.file.truncated)throw new BadRequestException('Choose a photo up to 5 MiB.');upload={filename:part.filename,mimetype:part.mimetype,data};}
   else{if(Object.hasOwn(body,part.fieldname))throw new BadRequestException('Use each repair photo field once.');body[part.fieldname]=part.fieldname==='expected_revision'?Number(part.value):part.value;}
  }if(!upload)throw new BadRequestException('Choose a repair photo.');return this.facilities.addPhoto(req.authUser,school,z.uuid().parse(id),body,upload);
 }
 @Get('repairs/:id/photos/:photoId') async photo(@Req() req:AuthenticatedRequest,@Res() reply:FastifyReply,@Param('schoolId') school:string,@Param('id') id:string,@Param('photoId') photoId:string){
  const file=await this.facilities.photo(req.authUser,school,z.uuid().parse(id),z.uuid().parse(photoId));reply.type(file.content_type).header('Content-Disposition',attachmentContentDisposition(file.original_name)).header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('X-ThatCampus-Evidence-Mode',file.evidence_mode).header('X-ThatCampus-Source-Content-Omitted',String(file.source_content_omitted));return reply.send(file.stream);
 }
}
