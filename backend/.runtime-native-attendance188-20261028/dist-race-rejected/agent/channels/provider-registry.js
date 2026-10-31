var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, NotFoundException } from '@nestjs/common';
import { TelegramChannelProvider } from './telegram-provider.js';
let MessagingChannelProviderRegistry = class MessagingChannelProviderRegistry {
    providers = new Map();
    health = new Map();
    initializing = null;
    constructor() { this.register(new TelegramChannelProvider()); }
    register(provider) { this.providers.set(provider.name, provider); }
    async initialize() {
        if (this.initializing)
            return this.initializing;
        this.initializing = this.initializeDue().finally(() => { this.initializing = null; });
        return this.initializing;
    }
    async initializeDue() {
        await Promise.all([...this.providers.values()].map(async (provider) => {
            const previous = this.health.get(provider.name);
            if (previous && (!previous.unavailable || previous.retryAt > Date.now()))
                return;
            try {
                await provider.initialize?.();
                this.health.set(provider.name, { retryAt: 0, attempts: 0, unavailable: false });
            }
            catch {
                const attempts = (previous?.attempts ?? 0) + 1;
                this.health.set(provider.name, { retryAt: Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(attempts - 1, 5)), attempts, unavailable: true });
            }
        }));
    }
    get(name) { const provider = this.providers.get(name); if (!provider)
        throw new NotFoundException('Messaging provider is not supported.'); return provider; }
    list() {
        return [...this.providers.values()].map(provider => ({ ...provider.publicIdentity(),
            availability: this.health.get(provider.name)?.unavailable ? 'temporarily_unavailable' : provider.configured() ? 'ready' : 'not_configured' }));
    }
};
MessagingChannelProviderRegistry = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], MessagingChannelProviderRegistry);
export { MessagingChannelProviderRegistry };
//# sourceMappingURL=provider-registry.js.map