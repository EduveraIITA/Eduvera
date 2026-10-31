import 'reflect-metadata';
import { randomUUID,createHash } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { AgentService } from '../src/agent/agent.service.js';
import { AgentChannelService } from '../src/agent/channels/channel.service.js';
import { MessagingChannelProviderRegistry } from '../src/agent/channels/provider-registry.js';
import { TelegramChannelProvider } from '../src/agent/channels/telegram-provider.js';
import { RolesService } from '../src/roles/roles.service.js';
import type { AgentGateway } from '../src/agent/gateway.js';
import type { AgentMemoryService } from '../src/agent/long-term-memory.js';
import type { AuthenticatedRequest } from '../src/common/request.js';
import { createClassPracticeFixture } from './class-practice.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
if(enabled)requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
describe.skipIf(!enabled)('atomic external link and durable outbound recovery',()=>{
  let db:DatabaseService;
  const opened:AgentChannelService[]=[];
  beforeAll(()=>{db=new DatabaseService();});
  afterAll(async()=>{for(const service of opened)await service.onModuleDestroy();await db?.destroy();});
  async function setup(){
    const f=await createClassPracticeFixture(db);
    await sql`UPDATE users SET pro_features_enabled=true WHERE id=${f.owner.id}::uuid`.execute(db);
    const agent=new AgentService(db,new RolesService(db),f.school,{} as AgentGateway,{} as AgentMemoryService);
    let networkCalls=0;
    const provider=new TelegramChannelProvider({enabled:true,token:'fictional-test-token',username:'ThatCampusBot',webhookSecret:'fictional-test-secret'},
      vi.fn<typeof fetch>(()=>Promise.resolve(new Response(JSON.stringify({ok:true,result:{message_id:++networkCalls}}),{status:200}))));
    const registry=new MessagingChannelProviderRegistry();registry.register(provider);
    const channels=new AgentChannelService(db,agent,registry);
    opened.push(channels);
    const raw=randomUUID()+randomUUID(),hash=createHash('sha256').update(raw).digest('hex');
    const token=(await sql<{id:string}>`INSERT INTO agent_channel_link_tokens(owner_id,school_id,portal,provider,token_hash,expires_at)
      VALUES(${f.owner.id}::uuid,${f.schoolId}::uuid,'principal','telegram',${hash},now()+interval '5 minutes') RETURNING id`.execute(db)).rows[0]!;
    const external=String(Date.now())+randomUUID().slice(0,4);
    const update=(await sql<{id:string}>`INSERT INTO agent_channel_updates(provider,provider_update_id,external_user_id,external_chat_id,
      provider_message_id,sender_label,message_text,link_token_hash) VALUES('telegram',${randomUUID()},${external},${external},'1','Fictional owner','/start',${hash}) RETURNING id`.execute(db)).rows[0]!;
    const pending={id:update.id,provider:'telegram' as const,updateId:randomUUID(),externalUserId:external,externalChatId:external,messageId:'1',senderLabel:'Fictional owner',text:'/start',linkTokenHash:hash,attempts:1};
    const work=()=>channels['process'](pending);
    const counts=async()=>(await sql<{consumed:boolean;threads:number;connections:number}>`SELECT
      (SELECT consumed_at IS NOT NULL FROM agent_channel_link_tokens WHERE id=${token.id}::uuid) AS consumed,
      (SELECT count(*)::int FROM agent_threads WHERE owner_id=${f.owner.id}::uuid) AS threads,
      (SELECT count(*)::int FROM agent_channel_connections WHERE owner_id=${f.owner.id}::uuid) AS connections`.execute(db)).rows[0]!;
    return {f,agent,channels,token,update,pending,work,counts,network:()=>networkCalls};
  }
  it('rolls back token, thread and connection together if the linking transaction fails',async()=>{
    const x=await setup();
    const execute=x.agent.createChannelThread.bind(x.agent);
    const fault=vi.spyOn(x.agent,'createChannelThread').mockImplementation((user,id,portal,student,commit)=>
      execute(user,id,portal,student,async(tx,thread)=>{await commit(tx,thread);throw new Error('fault before atomic commit');}));
    await expect(x.work()).rejects.toThrow('fault before atomic commit');
    expect(await x.counts()).toEqual({consumed:false,threads:0,connections:0});
    fault.mockRestore();await x.work();
    expect(await x.counts()).toEqual({consumed:true,threads:1,connections:1});
    expect(x.network()).toBe(1);
  });
  it('resumes the committed binding after losing the local completion acknowledgement',async()=>{
    const x=await setup();
    const terminal=vi.spyOn(x.channels as never,'terminal' as never).mockRejectedValueOnce(new Error('fault after delivery'));
    await expect(x.work()).rejects.toThrow('fault after delivery');
    terminal.mockRestore();await x.work();
    expect(await x.counts()).toEqual({consumed:true,threads:1,connections:1});expect(x.network()).toBe(1);
    const status=(await sql<{status:string;message_text:string|null;link_token_hash:string|null}>`SELECT status,message_text,link_token_hash
      FROM agent_channel_updates WHERE id=${x.update.id}::uuid`.execute(db)).rows[0]!;
    expect(status).toEqual({status:'delivered',message_text:null,link_token_hash:null});
    // A consumed token never binds a different inbound update or external chat.
    const duplicate={...x.pending,id:randomUUID(),externalUserId:'other',externalChatId:'other'};
    const consume=()=>x.channels['process'](duplicate);
    // Insert the independent queue identity; a different update cannot reuse the completed binding.
    await sql`INSERT INTO agent_channel_updates(id,provider,provider_update_id,external_user_id,external_chat_id,
      provider_message_id,sender_label,message_text,link_token_hash) VALUES(${duplicate.id}::uuid,'telegram',${randomUUID()},'other','other','2','','/start',${x.pending.linkTokenHash})`.execute(db);
    await consume();expect(await x.counts()).toEqual({consumed:true,threads:1,connections:1});
  });
  it('keeps transport checkpoint metadata inaccessible to browser roles',async()=>{
    const x=await setup();await x.work();
    const parts=(await sql<{state:string;content_hash:string}>`SELECT state,content_hash FROM agent_channel_outbound_parts WHERE update_id=${x.update.id}::uuid`.execute(db)).rows;
    expect(parts).toHaveLength(1);expect(parts[0]).toMatchObject({state:'sent'});expect(parts[0]!.content_hash).toMatch(/^[a-f0-9]{64}$/);
    const listed=await x.channels.list({authUser:x.f.owner} as AuthenticatedRequest);
    expect(listed.providers[0]?.connection).not.toBeNull();
  });
});
