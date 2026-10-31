import { Injectable,NotFoundException } from '@nestjs/common';
import type { ChannelProviderName,MessagingChannelProvider } from './provider.js';
import { TelegramChannelProvider } from './telegram-provider.js';

@Injectable()
export class MessagingChannelProviderRegistry {
  private readonly providers=new Map<ChannelProviderName,MessagingChannelProvider>();
  private readonly health=new Map<ChannelProviderName,{retryAt:number;attempts:number;unavailable:boolean}>();
  private initializing:Promise<void>|null=null;
  constructor(){this.register(new TelegramChannelProvider());}
  register(provider:MessagingChannelProvider){this.providers.set(provider.name,provider);}
  async initialize(){
    if(this.initializing)return this.initializing;
    this.initializing=this.initializeDue().finally(()=>{this.initializing=null;});
    return this.initializing;
  }
  private async initializeDue(){
    await Promise.all([...this.providers.values()].map(async provider=>{
      const previous=this.health.get(provider.name);
      if(previous&&(!previous.unavailable||previous.retryAt>Date.now()))return;
      try {
        await provider.initialize?.();
        this.health.set(provider.name,{retryAt:0,attempts:0,unavailable:false});
      } catch {
        const attempts=(previous?.attempts??0)+1;
        this.health.set(provider.name,{retryAt:Date.now()+Math.min(300_000,15_000*2**Math.min(attempts-1,5)),attempts,unavailable:true});
      }
    }));
  }
  get(name:ChannelProviderName){const provider=this.providers.get(name);if(!provider)throw new NotFoundException('Messaging provider is not supported.');return provider;}
  list(){return [...this.providers.values()].map(provider=>({...provider.publicIdentity(),
    availability:this.health.get(provider.name)?.unavailable?'temporarily_unavailable' as const:provider.configured()?'ready' as const:'not_configured' as const}));}
}
