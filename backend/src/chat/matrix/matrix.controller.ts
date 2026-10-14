import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../../common/request.js';
import { RequirePermission } from '../../roles/permissions.js';
import { MatrixTransportService } from './matrix-transport.service.js';

@ApiTags('chat')
@ApiCookieAuth()
@Controller('api/v1/chat/engine')
export class MatrixController {
  constructor(private readonly matrix: MatrixTransportService) {}
  @Get('conversations/:conversationId/')
  @RequirePermission('messages.view')
  status(@Req() request: AuthenticatedRequest,@Param('conversationId') id: string) {
    return this.matrix.status(request.authUser,id);
  }
  @Post('conversations/:conversationId/retry/')
  @HttpCode(200)
  @RequirePermission('messages.send')
  retry(@Req() request: AuthenticatedRequest,@Param('conversationId') id: string) {
    return this.matrix.retry(request.authUser,id);
  }
  @Patch('schools/:schoolId/')
  configure(@Req() request: AuthenticatedRequest,@Param('schoolId') id: string,@Body() input: unknown) {
    const body = z.object({ enabled: z.boolean() }).strict().parse(input);
    return this.matrix.configureSchool(request.authUser,id,body.enabled);
  }
}
