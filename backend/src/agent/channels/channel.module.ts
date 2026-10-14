import { Module } from '@nestjs/common';
import { AgentModule } from '../agent.module.js';
import { AgentChannelController } from './channel.controller.js';
import { AgentChannelService } from './channel.service.js';
import { MessagingChannelProviderRegistry } from './provider-registry.js';

@Module({imports:[AgentModule],controllers:[AgentChannelController],providers:[AgentChannelService,MessagingChannelProviderRegistry]})
export class AgentChannelModule {}
