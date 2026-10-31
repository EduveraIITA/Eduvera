var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { AgentModule } from '../agent.module.js';
import { AgentChannelController } from './channel.controller.js';
import { AgentChannelService } from './channel.service.js';
import { MessagingChannelProviderRegistry } from './provider-registry.js';
let AgentChannelModule = class AgentChannelModule {
};
AgentChannelModule = __decorate([
    Module({ imports: [AgentModule], controllers: [AgentChannelController], providers: [AgentChannelService, MessagingChannelProviderRegistry] })
], AgentChannelModule);
export { AgentChannelModule };
//# sourceMappingURL=channel.module.js.map