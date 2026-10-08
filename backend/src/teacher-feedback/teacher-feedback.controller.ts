import { Body, Controller, Get, Header, Param, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { TeacherFeedbackService } from './teacher-feedback.service.js';
@Controller('api/v1/schools/:schoolId/teacher-feedback')
export class TeacherFeedbackController {
  constructor(private readonly feedback:TeacherFeedbackService) {}
  @Get() @Header('Cache-Control','private, no-store')
  workspace(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string){return this.feedback.workspace(req.authUser,school);}
  @Post()
  create(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Body() body:unknown){return this.feedback.create(req.authUser,school,body);}
  @Get('pending') @Header('Cache-Control','private, no-store')
  pending(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string){return this.feedback.pending(req.authUser,school);}
  @Get(':id/results') @Header('Cache-Control','private, no-store')
  results(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.feedback.results(req.authUser,school,id);}
  @Post(':id/close')
  close(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string){return this.feedback.close(req.authUser,school,id);}
  @Post(':id/responses')
  submit(@Req() req:AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Body() body:unknown){return this.feedback.submit(req.authUser,school,id,body);}
}
