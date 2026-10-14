import { Controller,Delete,Get,HttpCode,Param,Post,Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public,SkipCsrf } from '../../common/decorators.js';
import type { AuthenticatedRequest } from '../../common/request.js';
import { AgentChannelService } from './channel.service.js';

@Controller('api/v1/agent/channels')
export class AgentChannelController {
  constructor(private readonly channels:AgentChannelService){}
  @Get() list(@Req() request:AuthenticatedRequest){return this.channels.list(request);}
  @Post('link') @HttpCode(201) link(@Req() request:AuthenticatedRequest){return this.channels.issueLink(request);}
  @Delete(':provider') disconnect(@Req() request:AuthenticatedRequest,@Param('provider') provider:string){return this.channels.revoke(request,provider);}
  @Public() @SkipCsrf() @Post(':provider/webhook') @HttpCode(200)
  webhook(@Req() request:FastifyRequest,@Param('provider') provider:string){
    const secret=request.headers['x-telegram-bot-api-secret-token'];
    return this.channels.ingest(provider,typeof secret==='string'?secret:undefined,request.body);
  }
}
