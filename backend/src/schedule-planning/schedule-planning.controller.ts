import { Controller, Get, Post, Req, Query, Param, HttpCode } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { SchedulePlanningService } from './schedule-planning.service.js';
@Controller('api/v1/schedule-planning')
export class SchedulePlanningController {
  constructor(private readonly service:SchedulePlanningService) {}
  @Get() screen(@Req() r:AuthenticatedRequest,@Query('term_id') term?:string){return this.service.screen(r.authUser,term);}
  @Post('years') @HttpCode(200) year(@Req() r:AuthenticatedRequest){return this.service.prepareYear(r,r.body);}
  @Post('drafts') @HttpCode(200) start(@Req() r:AuthenticatedRequest){return this.service.start(r,r.body);}
  @Post(':id/save') @HttpCode(200) save(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.service.save(r,id,r.body);}
  @Post(':id/publish') @HttpCode(200) publish(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.service.publish(r,id,r.body);}
  @Post(':id/discard') @HttpCode(200) discard(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.service.discard(r,id,r.body);}
}
