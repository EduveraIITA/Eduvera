import { Body, Controller, Get, Param, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../common/request.js';
import { RequirePermission } from '../roles/permissions.js';
import { StudentPulseService } from './student-pulse.service.js';
@Controller('api/v1/schools/:schoolId/student-pulse')
@RequirePermission('followups.manage')
export class StudentPulseController {
  constructor(private readonly pulse: StudentPulseService) {}
  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Res({passthrough:true}) reply: FastifyReply) {
    reply.header('Cache-Control','private, no-store');
    return this.pulse.list(request.authUser,school);
  }
  @Get(':studentId/:termId/:subjectId')
  detail(@Req() request: AuthenticatedRequest, @Param() p: Record<string,string>, @Res({passthrough:true}) reply: FastifyReply) {
    reply.header('Cache-Control','private, no-store');
    return this.pulse.detail(request.authUser,p.schoolId!,p.studentId!,p.termId!,p.subjectId!);
  }
  @Put(':studentId/:termId/:subjectId')
  save(@Req() request: AuthenticatedRequest, @Param() p: Record<string,string>, @Body() body: unknown, @Res({passthrough:true}) reply: FastifyReply) {
    reply.header('Cache-Control','private, no-store');
    return this.pulse.save(request.authUser,p.schoolId!,p.studentId!,p.termId!,p.subjectId!,body);
  }
}
