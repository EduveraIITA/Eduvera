import { afterEach,describe,expect,it,vi } from 'vitest';
import { channelDeliveryCheckpoint,type ChannelPartStore } from '../src/agent/channels/delivery-checkpoint.js';
import { ChannelDeliveryError,UncertainChannelDeliveryError,type MessagingChannelProvider } from '../src/agent/channels/provider.js';
import { TelegramChannelProvider } from '../src/agent/channels/telegram-provider.js';
import { MessagingChannelProviderRegistry } from '../src/agent/channels/provider-registry.js';

class Parts implements ChannelPartStore {
  readonly rows=new Map<number,{state:string;digest:string;count:number;messageId:string}>();
  async claim(index:number,count:number,digest:string){
    await Promise.resolve();
    let row=this.rows.get(index);
    if(!row){row={state:'prepared',digest,count,messageId:''};this.rows.set(index,row);}
    if(row.digest!==digest||row.count!==count)throw new UncertainChannelDeliveryError();
    if(row.state==='sent')return {state:'sent' as const,messageId:row.messageId};
    if(['sending','uncertain'].includes(row.state))return {state:'uncertain' as const,messageId:''};
    row.state='sending';return {state:'claimed' as const,messageId:''};
  }
  accepted(index:number,messageId:string){const row=this.rows.get(index)!;row.state='sent';row.messageId=messageId;return Promise.resolve();}
  failed(index:number,acceptance:'rejected'|'unknown'){this.rows.get(index)!.state=acceptance==='rejected'?'rejected':'uncertain';return Promise.resolve();}
}
const settings={enabled:true,token:'fictional-token',username:'ThatCampusBot',webhookSecret:'fictional-secret'};
const ok=(id:number)=>new Response(JSON.stringify({ok:true,result:{message_id:id}}),{status:200});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

describe('durable outbound channel recovery',()=>{
  it('reuses accepted chunks and retries only an explicitly rejected chunk',async()=>{
    const parts=new Parts(),sizes:number[]=[];let call=0;
    const request=vi.fn<typeof fetch>((_url,init)=>{
      if(typeof init?.body!=='string')throw new Error('Expected serialized provider body');
      sizes.push((JSON.parse(init.body) as {text:string}).text.length);
      return Promise.resolve(++call===2?new Response(JSON.stringify({ok:false,error_code:429}),{status:429}):ok(call));
    });
    const provider=new TelegramChannelProvider(settings,request),input={externalChatId:'91',text:'A'.repeat(7801)};
    await expect(provider.send(input,channelDeliveryCheckpoint(parts))).rejects.toMatchObject({acceptance:'rejected'});
    const result=await provider.send(input,channelDeliveryCheckpoint(parts));
    expect(result.messageIds).toEqual(['1','3','4']);
    expect(sizes).toEqual([3900,3900,3900,1]);
  });
  it('never repeats an ambiguously accepted part after a timeout or restart',async()=>{
    const parts=new Parts();let call=0;
    const request=vi.fn<typeof fetch>(async()=>++call===1?ok(1):Promise.reject(new Error('socket closed after remote acceptance')));
    const provider=new TelegramChannelProvider(settings,request),input={externalChatId:'91',text:'A'.repeat(4000)};
    await expect(provider.send(input,channelDeliveryCheckpoint(parts))).rejects.toMatchObject({acceptance:'unknown'});
    const restarted=new TelegramChannelProvider(settings,request);
    await expect(restarted.send(input,channelDeliveryCheckpoint(parts))).rejects.toBeInstanceOf(UncertainChannelDeliveryError);
    expect(request).toHaveBeenCalledTimes(2);
    expect(parts.rows.get(0)?.state).toBe('sent');expect(parts.rows.get(1)?.state).toBe('uncertain');
  });
  it('treats a crash after send but before checkpoint acknowledgement as uncertain',async()=>{
    const parts=new Parts(),request=vi.fn<typeof fetch>(()=>Promise.resolve(ok(1)));
    const checkpoint=channelDeliveryCheckpoint(parts);
    checkpoint.accepted=()=>Promise.reject(new Error('database acknowledgement lost'));
    const provider=new TelegramChannelProvider(settings,request),input={externalChatId:'91',text:'hello'};
    await expect(provider.send(input,checkpoint)).rejects.toThrow('database acknowledgement lost');
    await expect(provider.send(input,channelDeliveryCheckpoint(parts))).rejects.toBeInstanceOf(UncertainChannelDeliveryError);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects changed reply text or target on the same delivery identity',async()=>{
    const parts=new Parts(),provider=new TelegramChannelProvider(settings,vi.fn<typeof fetch>(()=>Promise.resolve(ok(1))));
    await provider.send({externalChatId:'91',text:'hello'},channelDeliveryCheckpoint(parts));
    await expect(provider.send({externalChatId:'92',text:'hello'},channelDeliveryCheckpoint(parts))).rejects.toBeInstanceOf(UncertainChannelDeliveryError);
    await expect(provider.send({externalChatId:'91',text:'changed'},channelDeliveryCheckpoint(parts))).rejects.toBeInstanceOf(UncertainChannelDeliveryError);
  });
  it('does not treat malformed success responses or transport errors as rejection',async()=>{
    for(const response of [new Response('bad gateway',{status:502}),new Response(JSON.stringify({ok:true,result:{}}),{status:200})]){
      const provider=new TelegramChannelProvider(settings,vi.fn<typeof fetch>(()=>Promise.resolve(response)));
      await expect(provider.send({externalChatId:'91',text:'hello'})).rejects.toEqual(new ChannelDeliveryError('unknown'));
    }
  });
  it('initializes optional providers independently and bounds recovery retries',async()=>{
    vi.stubEnv('DATABASE_URL','postgresql://localhost/thatcampus_test');vi.useFakeTimers();
    const registry=new MessagingChannelProviderRegistry();let calls=0;
    const adapter:MessagingChannelProvider={name:'telegram',configured:()=>calls>1,publicIdentity:()=>({name:'telegram',configured:calls>1,label:'Telegram'}),
      initialize:()=>++calls===1?Promise.reject(new Error('provider outage')):Promise.resolve(),connectionUrl:()=>'',parseWebhook:()=>null,send:()=>Promise.resolve({messageIds:[]})};
    registry.register(adapter);
    await expect(registry.initialize()).resolves.toBeUndefined();
    expect(registry.list()[0]).toMatchObject({availability:'temporarily_unavailable'});
    await registry.initialize();expect(calls).toBe(1);
    vi.advanceTimersByTime(15_001);await registry.initialize();
    expect(calls).toBe(2);expect(registry.list()[0]).toMatchObject({availability:'ready'});
  });
});
