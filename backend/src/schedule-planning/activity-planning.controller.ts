import { Controller, Get, Post, Put, Req, Query, Param, HttpCode } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { ActivityPlanningService } from './activity-planning.service.js';

@Controller('api/v1/schools/:schoolId/activities')
export class ActivityPlanningController {
  constructor(private readonly service: ActivityPlanningService) {}
  @Get('catalogue') catalogue(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string) { return this.service.catalogue(r.authUser, school); }
  @Get('plans') plans(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string, @Query() query: unknown) { return this.service.listPlans(r.authUser, school, query); }
  @Get('plans/:id') plan(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.getPlan(r.authUser, school, id); }
  @Post('plans') create(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string) { return this.service.create(r, school, r.body); }
  @Put('plans/:id') @HttpCode(200) update(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.update(r, school, id, r.body); }
  @Post('plans/:id/publish') @HttpCode(200) publish(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.publish(r, school, id, r.body); }
  @Post('plans/:id/revise') @HttpCode(200) revise(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.revise(r, school, id, r.body); }
  @Post('plans/:id/cancel') @HttpCode(200) cancel(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.cancel(r, school, id, r.body); }
  @Get('occurrences') occurrences(@Req() r: AuthenticatedRequest, @Param('schoolId') school: string, @Query() query: unknown) { return this.service.listOccurrences(r.authUser, school, query); }
}
