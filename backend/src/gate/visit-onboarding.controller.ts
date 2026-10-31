import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { LiveAccountControl, Public, SkipCsrf } from '../common/decorators.js';
import type { AuthenticatedRequest, RequestWithContext } from '../common/request.js';
import { VisitOnboardingService } from './visit-onboarding.service.js';

@Controller('api/v1/gate/schools/:schoolId/visit-arrangements')
export class VisitOnboardingController {
  constructor(private readonly service: VisitOnboardingService) {}
  @Get('registered') registered(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Query('page') page?: string) { return this.service.registered(req.authUser, school, page); }
  @Get(':id/participant') participant(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.participant(req.authUser, school, id); }
  @Get(':id/onboarding-link') detail(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.management(req.authUser, school, id); }
  @Get(':id/onboarding-link/commands/:command') confirmation(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Param('command') command: string) { return this.service.confirmation(req.authUser, school, id, command); }
  @Post(':id/onboarding-link') @Header('Cache-Control', 'private, no-store') change(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Body() body: unknown) { return this.service.change(req.authUser, school, id, body); }
  @Post(':id/onboarding-link/reveal') @HttpCode(200) @Header('Cache-Control', 'private, no-store') reveal(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Body() body: unknown) { return this.service.reveal(req.authUser, school, id, body); }
}

/** Public credentials stay in POST bodies, never route/query logs. Native
 * anonymous forms use the same bounded source/proof logic without cookie CSRF. */
@Controller('api/v1/auth')
export class PublicVisitOnboardingController {
  constructor(private readonly service: VisitOnboardingService) {}
  @Public() @LiveAccountControl() @Post('visit-onboarding/preview') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  preview(@Body() body: unknown) { return this.service.preview(body); }
  @Public() @LiveAccountControl() @SkipCsrf() @Post('native/visit-onboarding/preview') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  nativePreview(@Body() body: unknown) { return this.service.preview(body); }
  @Public() @LiveAccountControl() @Post('visit-onboarding/proof') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  proof(@Req() req: RequestWithContext, @Body() body: unknown) { return this.service.proof(body, req.ip); }
  @Public() @LiveAccountControl() @SkipCsrf() @Post('native/visit-onboarding/proof') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  nativeProof(@Req() req: RequestWithContext, @Body() body: unknown) { return this.service.proof(body, req.ip); }
  @Public() @LiveAccountControl() @Post('visit-onboarding/account') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  account(@Body() body: unknown) { return this.service.account(body); }
  @Public() @LiveAccountControl() @SkipCsrf() @Post('native/visit-onboarding/account') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  nativeAccount(@Body() body: unknown) { return this.service.account(body); }
  @Post('visit-onboarding/join') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  join(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    if (req.executionEnvironmentView.mode !== 'live' || req.publicDemo || req.internalAgentDelegation)
      throw new ForbiddenException('Real visitor identity joining requires your own normal Live account.');
    return this.service.join(req.authUser, body);
  }
}
