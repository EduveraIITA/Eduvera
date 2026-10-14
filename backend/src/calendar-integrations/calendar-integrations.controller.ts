import {Controller,Delete,Get,HttpCode,Param,Post,Query,Req,Res} from '@nestjs/common';
import type {FastifyReply,FastifyRequest} from 'fastify';
import {createHash} from 'node:crypto';
import {Public,SkipCsrf} from '../common/decorators.js';
import type {AuthenticatedRequest} from '../common/request.js';
import {CalendarIntegrationsService} from './calendar-integrations.service.js';

@Controller('api/v1/calendar-connections')
export class CalendarIntegrationsController {
  constructor(private readonly calendars:CalendarIntegrationsService){}
  @Get() status(@Req() request:AuthenticatedRequest,@Query() query:Record<string,string|undefined>){return this.calendars.status(request,query);}
  @Post('subscriptions') @HttpCode(201) create(@Req() request:AuthenticatedRequest){return this.calendars.createSubscription(request);}
  @Delete('subscriptions/:id') revoke(@Req() request:AuthenticatedRequest,@Param('id') id:string){return this.calendars.revoke(request,id);}
  @Get('export.ics') async export(@Req() request:AuthenticatedRequest,@Query() query:Record<string,string|undefined>,@Res() reply:FastifyReply){
    const result=await this.calendars.export(request,query);return reply.header('Cache-Control','private, no-store')
      .header('Content-Disposition',`attachment; filename="${result.filename}"`).type('text/calendar; charset=utf-8').send(result.body);
  }
  @Public() @SkipCsrf() @Get('subscriptions/:token/feed.ics') async feed(@Req() request:FastifyRequest,@Param('token') token:string,@Res() reply:FastifyReply){
    const body=await this.calendars.feed(token);const etag=`"${createHash('sha256').update(body).digest('base64url')}"`;
    if(request.headers['if-none-match']===etag)return reply.status(304).send();
    return reply.header('Cache-Control','private, max-age=300').header('ETag',etag).type('text/calendar; charset=utf-8').send(body);
  }
}
