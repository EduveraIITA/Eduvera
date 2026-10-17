import { describe,expect,it,vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { TelegramChannelProvider,type TelegramSettings } from '../src/agent/channels/telegram-provider.js';
import { MessagingChannelProviderRegistry } from '../src/agent/channels/provider-registry.js';
import type { MessagingChannelProvider } from '../src/agent/channels/provider.js';
import { InternalAgentDelegationService } from '../src/auth/internal-agent-delegation.js';
import type { AuthUser } from '../src/common/request.js';

const settings:TelegramSettings={enabled:true,token:'123456789:abcdefghijklmnopqrstuvwxyz',username:'ThatCampusBot',webhookSecret:'0123456789abcdefghijklmn',publicUrl:'https://school.example'};

describe('provider-neutral assistant channels',()=>{
  it('normalizes only private Telegram text and extracts a one-time link token',()=>{
    const provider=new TelegramChannelProvider(settings,vi.fn<typeof fetch>());
    const update=provider.parseWebhook(settings.webhookSecret,{update_id:44,message:{message_id:7,text:'/start AbCd_12345678901234567890',
      chat:{id:91,type:'private'},from:{id:91,first_name:'Meera',last_name:'Kapoor'}}});
    expect(update).toMatchObject({provider:'telegram',updateId:'44',externalUserId:'91',externalChatId:'91',messageId:'7',senderLabel:'Meera Kapoor',linkToken:'AbCd_12345678901234567890'});
    expect(provider.parseWebhook(settings.webhookSecret,{update_id:45,message:{message_id:8,text:'hello',chat:{id:-1,type:'group'},from:{id:91}}})).toBeNull();
    expect(provider.parseWebhook(settings.webhookSecret,{update_id:'45',message:{message_id:8,text:'hello',chat:{id:91,type:'private'},from:{id:91}}})).toBeNull();
  });

  it('fails closed when Telegram webhook verification is missing or wrong',()=>{
    const provider=new TelegramChannelProvider(settings,vi.fn<typeof fetch>());
    expect(()=>provider.parseWebhook('wrong',{update_id:1})).toThrow(UnauthorizedException);
    expect(()=>provider.parseWebhook(undefined,{update_id:1})).toThrow(UnauthorizedException);
  });

  it('resolves the bot username from Telegram when configuration omits it',async()=>{
    const request:typeof fetch=vi.fn(()=>Promise.resolve(new Response(JSON.stringify({ok:true,result:{is_bot:true,username:'ThatCampusBot'}}),
      {status:200,headers:{'content-type':'application/json'}})));
    const settingsWithoutUsername:TelegramSettings={enabled:settings.enabled,token:settings.token,webhookSecret:settings.webhookSecret,publicUrl:'https://school.example'};
    const provider=new TelegramChannelProvider(settingsWithoutUsername,request);
    expect(provider.configured()).toBe(false);
    await provider.initialize();
    expect(provider.publicIdentity()).toMatchObject({configured:true,username:'@ThatCampusBot'});
  });

  it('splits long replies, keeps tokens server-side and attaches review links once',async()=>{
    const bodies:Record<string,unknown>[]=[];
    const requestMock=vi.fn((_url:string|URL|Request,init?:RequestInit)=>{
      if(typeof init?.body!=='string')throw new Error('Expected JSON request body');
      const body=JSON.parse(init.body) as Record<string,unknown>;bodies.push(body);
      return Promise.resolve(new Response(JSON.stringify({ok:true,result:{message_id:bodies.length,echo:body}}),{status:200,headers:{'content-type':'application/json'}}));
    });
    const request:typeof fetch=requestMock;
    const provider=new TelegramChannelProvider(settings,request);
    const result=await provider.send({externalChatId:'91',text:'A'.repeat(7801),action:{label:'Review in ThatCampus',url:'https://school.example/principal/assistant?thread=x'}});
    expect(result.messageIds).toHaveLength(3);expect(request).toHaveBeenCalledTimes(3);
    const requestedUrl=requestMock.mock.calls[0]![0];
    expect(typeof requestedUrl==='string'?requestedUrl:requestedUrl instanceof URL?requestedUrl.href:requestedUrl.url).toContain(settings.token);
    const first=bodies[0]!;const last=bodies[2]! as {reply_markup:{inline_keyboard:Array<Array<{text:string}>>}};
    expect(first).not.toHaveProperty('reply_markup');expect(last.reply_markup.inline_keyboard.flat()[0]).toMatchObject({text:'Review in ThatCampus'});
  });

  it('allows another transport adapter without changing the agent contract',()=>{
    vi.stubEnv('DATABASE_URL','postgresql://test:test@127.0.0.1:5432/omnischool_test');
    const registry=new MessagingChannelProviderRegistry();
    const adapter:MessagingChannelProvider={name:'whatsapp',configured:()=>false,publicIdentity:()=>({name:'whatsapp',configured:false,label:'WhatsApp'}),
      connectionUrl:()=>'',parseWebhook:()=>null,send:()=>Promise.resolve({messageIds:[]})};
    registry.register(adapter);
    expect(registry.list().map(item=>item.name)).toEqual(['telegram','whatsapp']);
    expect(registry.get('whatsapp')).toBe(adapter);
  });

  it('uses internal agent identity delegations once',()=>{
    const delegations=new InternalAgentDelegationService();
    const user:AuthUser={id:'00000000-0000-4000-8000-000000000001',username:'meera',email:'meera@example.test',first_name:'Meera',last_name:'Kapoor',
      role:'admin',is_active:true,email_verified_at:null,active_school_id:'00000000-0000-4000-8000-000000000002'};
    const token=delegations.issue(user,'00000000-0000-4000-8000-000000000003');
    expect(delegations.consume(token)).toMatchObject({user:{id:user.id},requestId:'00000000-0000-4000-8000-000000000003'});
    expect(delegations.consume(token)).toBeNull();
  });
});
