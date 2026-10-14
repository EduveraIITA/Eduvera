import { Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module.js';
import { SchoolModule } from '../school/school.module.js';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';
import { AgentGateway } from './gateway.js';
import { AgentMemoryService } from './long-term-memory.js';
import { AuthModule } from '../auth/auth.module.js';
@Module({ imports:[RolesModule,SchoolModule,AuthModule],controllers:[AgentController],providers:[AgentService,AgentGateway,AgentMemoryService],exports:[AgentService] })
export class AgentModule {}
