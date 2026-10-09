import { Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module.js';
import { SchoolModule } from '../school/school.module.js';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';
import { AgentGateway } from './gateway.js';
import { AgentMemoryService } from './long-term-memory.js';
@Module({ imports:[RolesModule,SchoolModule],controllers:[AgentController],providers:[AgentService,AgentGateway,AgentMemoryService] })
export class AgentModule {}
