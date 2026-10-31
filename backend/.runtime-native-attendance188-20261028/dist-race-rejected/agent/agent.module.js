var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module.js';
import { SchoolModule } from '../school/school.module.js';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';
import { AgentGateway } from './gateway.js';
import { AgentMemoryService } from './long-term-memory.js';
import { AuthModule } from '../auth/auth.module.js';
let AgentModule = class AgentModule {
};
AgentModule = __decorate([
    Module({ imports: [RolesModule, SchoolModule, AuthModule], controllers: [AgentController], providers: [AgentService, AgentGateway, AgentMemoryService], exports: [AgentService] })
], AgentModule);
export { AgentModule };
//# sourceMappingURL=agent.module.js.map