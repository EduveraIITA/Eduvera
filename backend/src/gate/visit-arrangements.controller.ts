import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { RequirePermission } from '../roles/permissions.js';
import { VisitArrangementsService } from './visit-arrangements.service.js';

@Controller('api/v1/gate/schools/:schoolId/visit-arrangements')
@RequirePermission('gate.manage')
export class VisitArrangementsController {
  constructor(private readonly service: VisitArrangementsService) {}
  @Get('/') workspace(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Query() query: unknown) { return this.service.workspace(request.authUser, school, query); }
  @Get('/options/') options(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Query() query: unknown) { return this.service.options(request.authUser, school, query); }
  @Post('/') create(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Body() body: unknown) { return this.service.create(request.authUser, school, body); }
  @Get('/:id/') detail(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string) { return this.service.detail(request.authUser, school, id); }
  @Post('/:id/update/') update(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Body() body: unknown) { return this.service.update(request.authUser, school, id, body); }
  @Post('/:id/cancel/') cancel(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Body() body: unknown) { return this.service.cancel(request.authUser, school, id, body); }
  @Post('/:id/movements/') movement(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Body() body: unknown) { return this.service.movement(request.authUser, school, id, body); }
  @Get('/:id/commands/:commandId/') confirmation(@Req() request: AuthenticatedRequest, @Param('schoolId') school: string, @Param('id') id: string, @Param('commandId') commandId: string) { return this.service.confirmation(request.authUser, school, id, commandId); }
}
