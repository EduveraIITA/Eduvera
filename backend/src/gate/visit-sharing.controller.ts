import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { VisitSharingService } from './visit-sharing.service.js';

/** Source readers never pass through the management controller's broad permission. */
@Controller('api/v1/gate/schools/:schoolId/visit-arrangements')
export class VisitSharingController {
  constructor(private readonly service: VisitSharingService) {}
  @Get('/shared/discovery') discovery(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string) { return this.service.discovery(req.authUser, school); }
  @Get('/shared') shared(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Query() query: unknown) { return this.service.sharedWorkspace(req.authUser, school, query); }
  @Get('/:id/shared') detail(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.sharedDetail(req.authUser, school, id); }
  @Get('/:id/sharing') management(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.management(req.authUser, school, id); }
  @Post('/:id/shares') share(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Body() body: unknown) { return this.service.share(req.authUser, school, id, body); }
  @Post('/:id/shares/:share/revoke') revoke(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Param('share') share: string, @Body() body: unknown) { return this.service.revoke(req.authUser, school, id, share, body); }
  @Post('/:id/shares/:share/takeover') takeover(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Param('share') share: string, @Body() body: unknown) { return this.service.takeover(req.authUser, school, id, share, body); }
  @Post('/:id/shared/questions') ask(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Body() body: unknown) { return this.service.ask(req.authUser, school, id, body); }
  @Post('/:id/shared/questions/:question/replies') reply(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Param('question') question: string, @Body() body: unknown) { return this.service.reply(req.authUser, school, id, question, body); }
  @Get('/:id/shared/commands/:command') confirmation(@Req() req: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Param('command') command: string) { return this.service.confirmation(req.authUser, school, id, command); }
}
