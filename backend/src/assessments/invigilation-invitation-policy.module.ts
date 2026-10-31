import { Controller, Get, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../common/request.js';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
import { InvigilationInvitationPolicyService } from './invigilation-invitation-policy.service.js';

@Controller('api/v1/schools/:schoolId/assessments/invigilation-invitations')
export class InvigilationInvitationPolicyController {
  constructor(private readonly policies: InvigilationInvitationPolicyService) {}
  @Get('/') workspace(@Req() request: AuthenticatedRequest, @Param('schoolId') schoolId: string) {
    return this.policies.workspace(request.authUser, z.string().uuid().parse(schoolId));
  }
  @Post('/') @HttpCode(200) approve(@Req() request: AuthenticatedRequest, @Param('schoolId') schoolId: string) {
    return this.policies.approve(request, z.string().uuid().parse(schoolId), request.body);
  }
}
@Module({ imports: [CampusModelCoreModule], controllers: [InvigilationInvitationPolicyController],
  providers: [InvigilationInvitationPolicyService], exports: [InvigilationInvitationPolicyService] })
export class InvigilationInvitationPolicyModule {}
