import { Controller, Get, Post, Req, Param, Query, HttpCode } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { AgentService } from './agent.service.js';

@Controller('api/v1/agent')
export class AgentController {
  constructor(private readonly agent:AgentService) {}
  @Get('status') status(@Req() r:AuthenticatedRequest,@Query() q:unknown) { return this.agent.status(r,q); }
  @Get('threads') list(@Req() r:AuthenticatedRequest,@Query() q:unknown) { return this.agent.list(r,q); }
  @Post('threads') create(@Req() r:AuthenticatedRequest) { return this.agent.create(r); }
  @Get('threads/:id') detail(@Req() r:AuthenticatedRequest,@Param('id') id:string) { return this.agent.detail(r,id); }
  @Post('threads/:id/messages') @HttpCode(202) send(@Req() r:AuthenticatedRequest,@Param('id') id:string) { return this.agent.send(r,id); }
  @Post('threads/:id/runs/:runId/cancel') @HttpCode(200) cancel(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Param('runId') runId:string) { return this.agent.cancel(r,id,runId); }
  @Post('threads/:id/actions/:actionId') @HttpCode(200) decide(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Param('actionId') actionId:string) { return this.agent.decide(r,id,actionId); }
}
