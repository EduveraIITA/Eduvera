import { Controller, Delete, Get, Post, Req, Param, Query, HttpCode } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request.js';
import { AgentService } from './agent.service.js';
import { AgentMemoryService } from './long-term-memory.js';

@Controller('api/v1/agent')
export class AgentController {
  constructor(private readonly agent:AgentService,private readonly memory:AgentMemoryService) {}
  @Get('memories') memories(@Req() r:AuthenticatedRequest,@Query() q:unknown) { return this.memory.listForRequest(r,q); }
  @Delete('memories') clearMemories(@Req() r:AuthenticatedRequest) { return this.memory.clearForRequest(r); }
  @Delete('memories/:memoryId') removeMemory(@Req() r:AuthenticatedRequest,@Param('memoryId') memoryId:string) { return this.memory.removeForRequest(r,memoryId); }
  @Get('status') status(@Req() r:AuthenticatedRequest,@Query() q:unknown) { return this.agent.status(r,q); }
  @Get('threads') list(@Req() r:AuthenticatedRequest,@Query() q:unknown) { return this.agent.list(r,q); }
  @Post('threads') create(@Req() r:AuthenticatedRequest) { return this.agent.create(r); }
  @Get('threads/:id') detail(@Req() r:AuthenticatedRequest,@Param('id') id:string) { return this.agent.detail(r,id); }
  @Post('threads/:id/messages') @HttpCode(202) send(@Req() r:AuthenticatedRequest,@Param('id') id:string) { return this.agent.send(r,id); }
  @Post('threads/:id/runs/:runId/cancel') @HttpCode(200) cancel(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Param('runId') runId:string) { return this.agent.cancel(r,id,runId); }
  @Post('threads/:id/actions/:actionId') @HttpCode(200) decide(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Param('actionId') actionId:string) { return this.agent.decide(r,id,actionId); }
}
