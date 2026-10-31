import { Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../common/request.js';
import { PersonalProfileService } from './personal-profile.service.js';

@ApiTags('authentication')
@ApiCookieAuth()
@Controller('api/v1/auth/profile')
export class PersonalProfileController {
  constructor(private readonly profiles: PersonalProfileService) {}
  @Get('details/')
  read(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply) { reply.header('Cache-Control','no-store'); return this.profiles.read(request); }
  @Patch('details/')
  update(@Req() request: AuthenticatedRequest) { return this.profiles.update(request); }
  @Post('phone/request/') @HttpCode(200)
  requestCode(@Req() request: AuthenticatedRequest) { return this.profiles.requestCode(request); }
  @Post('phone/confirm/') @HttpCode(200)
  confirmCode(@Req() request: AuthenticatedRequest) { return this.profiles.confirmCode(request); }
}
