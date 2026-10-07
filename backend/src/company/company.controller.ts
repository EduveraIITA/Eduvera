import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { CompanyService } from './company.service.js';
@Controller('api/v1/company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}
  @Get('workspace/') workspace(@Req() req: AuthenticatedRequest) {return this.company.workspace(req.authUser);}
  @Post('institutions/') create(@Req() req: AuthenticatedRequest) {return this.company.create(req.authUser,req.body);}
  @Post('institutions/:schoolId/admin-invitations/') invite(@Req() req: AuthenticatedRequest,@Param('schoolId') school: string) {return this.company.inviteAdmin(req.authUser,school,req.body);}
  @Post('institutions/:schoolId/admin-invitations/:id/revoke/') revoke(@Req() req: AuthenticatedRequest,@Param('schoolId') school: string,@Param('id') id: string) {return this.company.revoke(req.authUser,school,id);}
  @Post('institution-applications/:id/review/') reviewApplication(@Req() req: AuthenticatedRequest,@Param('id') id: string) {return this.company.reviewApplication(req.authUser,id,req.body);}
}
