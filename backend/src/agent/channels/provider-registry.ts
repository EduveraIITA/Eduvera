import { Injectable,NotFoundException } from '@nestjs/common';
import type { ChannelProviderName,MessagingChannelProvider } from './provider.js';
import { TelegramChannelProvider } from './telegram-provider.js';

@Injectable()
export class MessagingChannelProviderRegistry {
  private readonly providers=new Map<ChannelProviderName,MessagingChannelProvider>();
  constructor(){this.register(new TelegramChannelProvider());}
  register(provider:MessagingChannelProvider){this.providers.set(provider.name,provider);}
  async initialize(){for(const provider of this.providers.values())await provider.initialize?.();}
  get(name:ChannelProviderName){const provider=this.providers.get(name);if(!provider)throw new NotFoundException('Messaging provider is not supported.');return provider;}
  list(){return [...this.providers.values()].map(provider=>provider.publicIdentity());}
}
