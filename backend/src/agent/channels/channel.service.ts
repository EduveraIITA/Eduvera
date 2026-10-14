import { ConflictException,ForbiddenException,Injectable,Logger,NotFoundException,type OnModuleDestroy,type OnModuleInit } from '@nestjs/common';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AuthenticatedRequest,AuthUser } from '../../common/request.js';
import { config } from '../../config.js';
import { DatabaseService } from '../../database/database.service.js';
import { AgentLimitError } from '../limits.js';
import { AgentService } from '../agent.service.js';
import type { ChannelProviderName,NormalizedChannelUpdate } from './provider.js';
import { MessagingChannelProviderRegistry } from './provider-registry.js';

const providerSchema=z.enum(['telegram','whatsapp']);
const portalSchema=z.enum(['principal','teacher','parent','student']);
const linkSchema=z.object({provider:providerSchema,portal:portalSchema,student_id:z.string().uuid().optional()}).strict();

interface Connection {
  id:string;owner_id:string;school_id:string;portal:'principal'|'teacher'|'parent'|'student';student_id:string|null;
  provider:ChannelProviderName;external_user_id:string;external_chat_id:string;agent_thread_id:string;state:string;linked_at:Date;
}
interface PendingUpdate extends NormalizedChannelUpdate {id:string;attempts:number;linkTokenHash:string|null}

function hash(value:string){return createHash('sha256').update(value).digest('hex');}
function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

@Injectable()
export class AgentChannelService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private working=false;
  private readonly logger=new Logger(AgentChannelService.name);
  constructor(private readonly db:DatabaseService,private readonly agent:AgentService,private readonly providers:MessagingChannelProviderRegistry) {}

  async onModuleInit(){
    await this.providers.initialize();
    if(!this.providers.list().some(provider=>provider.configured))return;
    const run=()=>void this.work().catch(error=>this.logger.warn(`Channel worker will retry: ${error instanceof Error?error.message:'unknown error'}`));
    this.timer=setInterval(run,config().AGENT_CHANNEL_WORKER_INTERVAL_MS);this.timer.unref();run();
    const telegram=this.providers.get('telegram');
    if(config().TELEGRAM_AUTO_REGISTER_WEBHOOK&&telegram.configured()&&telegram.registerWebhook) {
      void telegram.registerWebhook().then(()=>this.logger.log('Telegram webhook registered.')).catch(error=>this.logger.error(`Telegram webhook registration failed: ${error instanceof Error?error.message:'unknown error'}`));
    }
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}

  async list(request:AuthenticatedRequest){
    const connections=(await sql<{provider:ChannelProviderName;portal:string;student_id:string|null;linked_at:Date;last_inbound_at:Date|null;last_outbound_at:Date|null}>`
      SELECT provider,portal,student_id,linked_at,last_inbound_at,last_outbound_at FROM agent_channel_connections
      WHERE owner_id=${request.authUser.id}::uuid AND state='linked' ORDER BY linked_at DESC`.execute(this.db)).rows;
    return {providers:this.providers.list().map(provider=>({...provider,connection:connections.find(item=>item.provider===provider.name)??null}))};
  }

  async issueLink(request:AuthenticatedRequest){
    const input=linkSchema.parse(request.body);const provider=this.providers.get(input.provider);
    if(!provider.configured())throw new ConflictException(`${provider.publicIdentity().label} is not configured yet.`);
    if(input.provider!=='telegram')throw new ConflictException('This provider adapter is reserved but not enabled yet.');
    const scope=await this.agent.channelScope(request.authUser,request.requestId,input.portal,input.student_id);
    const raw=randomBytes(32).toString('base64url');const expiresAt=new Date(Date.now()+config().AGENT_CHANNEL_LINK_TTL_MINUTES*60_000);
    await this.db.transaction().execute(async tx=>{
      await sql`UPDATE agent_channel_link_tokens SET consumed_at=COALESCE(consumed_at,now())
        WHERE owner_id=${scope.userId}::uuid AND provider=${input.provider} AND consumed_at IS NULL`.execute(tx);
      await sql`INSERT INTO agent_channel_link_tokens(owner_id,school_id,portal,student_id,provider,token_hash,expires_at)
        VALUES(${scope.userId}::uuid,${scope.schoolId}::uuid,${scope.portal},${scope.studentId ?? null}::uuid,${input.provider},${hash(raw)},${expiresAt})`.execute(tx);
    });
    await this.audit(scope.userId,scope.schoolId,'agent.channel.link_issued',request.requestId,{provider:input.provider,portal:scope.portal,expires_at:expiresAt.toISOString()});
    return {provider:input.provider,connect_url:provider.connectionUrl(raw),expires_at:expiresAt.toISOString()};
  }

  async revoke(request:AuthenticatedRequest,providerName:string){
    const provider=providerSchema.parse(providerName);
    const rows=(await sql<{id:string;school_id:string}>`UPDATE agent_channel_connections SET state='revoked',revoked_at=now(),revision=revision+1
      WHERE owner_id=${request.authUser.id}::uuid AND provider=${provider} AND state='linked' RETURNING id,school_id`.execute(this.db)).rows;
    if(!rows.length)throw new NotFoundException('This messaging connection is not active.');
    await this.audit(request.authUser.id,rows[0]!.school_id,'agent.channel.revoked',request.requestId,{provider});
    return {provider,connected:false};
  }

  async ingest(providerName:string,secret:string|undefined,body:unknown){
    const provider=this.providers.get(providerSchema.parse(providerName));
    const update=provider.parseWebhook(secret,body);if(!update)return {accepted:true,ignored:true};
    const linkTokenHash=update.linkToken?hash(update.linkToken):null;
    await sql`INSERT INTO agent_channel_updates(provider,provider_update_id,external_user_id,external_chat_id,provider_message_id,sender_label,message_text,link_token_hash)
      VALUES(${update.provider},${update.updateId},${update.externalUserId},${update.externalChatId},${update.messageId},${update.senderLabel},${update.linkToken?'/start':update.text},${linkTokenHash})
      ON CONFLICT(provider,provider_update_id) DO NOTHING`.execute(this.db);
    return {accepted:true};
  }

  private async work(){
    if(this.working)return;this.working=true;
    try{
      await sql`UPDATE agent_channel_updates SET status='pending',lease_expires_at=NULL,next_attempt_at=now()
        WHERE status='processing' AND lease_expires_at<now() AND attempts<8`.execute(this.db);
      const update=await this.db.transaction().execute(async tx=>(await sql<PendingUpdate>`WITH candidate AS (
          SELECT id FROM agent_channel_updates WHERE status='pending' AND next_attempt_at<=now() ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE agent_channel_updates inbox SET status='processing',attempts=inbox.attempts+1,lease_expires_at=now()+interval '5 minutes'
          FROM candidate WHERE inbox.id=candidate.id RETURNING inbox.id,inbox.provider,inbox.provider_update_id AS "updateId",
          inbox.external_user_id AS "externalUserId",inbox.external_chat_id AS "externalChatId",inbox.provider_message_id AS "messageId",
          inbox.sender_label AS "senderLabel",inbox.message_text AS text,inbox.link_token_hash AS "linkTokenHash",inbox.attempts`.execute(tx)).rows[0]);
      if(!update)return;
      try{await this.process(update);}catch(error){await this.retry(update,error);}
    }finally{this.working=false;}
  }

  private async process(update:PendingUpdate){
    if(update.linkTokenHash){await this.consumeLink(update);return;}
    const provider=this.providers.get(update.provider);
    const connection=(await sql<Connection>`SELECT * FROM agent_channel_connections WHERE provider=${update.provider}
      AND external_user_id=${update.externalUserId} AND state='linked' LIMIT 1`.execute(this.db)).rows[0];
    if(!connection||connection.external_chat_id!==update.externalChatId){
      await provider.send({externalChatId:update.externalChatId,text:'Connect this chat from OmniSchool Profile → Connected apps before asking about school records.'});
      await this.terminal(update.id,'ignored');return;
    }
    const user=await this.user(connection);
    let runId:string;
    try{runId=(await this.agent.sendFromChannel(user,randomUUID(),connection.agent_thread_id,update.text,update.id)).run_id;}
    catch(error){
      if(error instanceof ConflictException||error instanceof ForbiddenException||error instanceof AgentLimitError){
        await provider.send({externalChatId:update.externalChatId,text:error.message,action:{label:'Open OmniSchool',url:this.assistantUrl(connection)}});
        await this.recordDelivery(connection,update,'outbound',error.message,'sent');await this.terminal(update.id,'delivered',connection.id);return;
      }
      throw error;
    }
    await sql`UPDATE agent_channel_updates SET connection_id=${connection.id}::uuid,agent_run_id=${runId}::uuid WHERE id=${update.id}::uuid`.execute(this.db);
    await this.recordDelivery(connection,update,'inbound',update.text,'accepted');
    let result=await this.agent.channelRun(user,randomUUID(),connection.agent_thread_id,runId);
    for(let pass=0;pass<235&&['running'].includes(result.status);pass++){await delay(1000);result=await this.agent.channelRun(user,randomUUID(),connection.agent_thread_id,runId);}
    if(result.status==='running')throw new Error('agent_timeout');
    const review=['pending','executing','uncertain'].includes(result.action?.status??'')||result.status==='confirmation';
    const answer=review?`${result.answer}\n\nReview this action securely in OmniSchool.`:result.answer;
    const sent=await provider.send({externalChatId:update.externalChatId,text:answer,...(review?{action:{label:'Review in OmniSchool',url:this.assistantUrl(connection)}}:{})});
    await this.recordDelivery(connection,update,'outbound',answer,'sent',sent.messageIds.join(','));
    await sql`UPDATE agent_channel_connections SET last_inbound_at=now(),last_outbound_at=now() WHERE id=${connection.id}::uuid`.execute(this.db);
    await this.terminal(update.id,'delivered',connection.id,runId);
  }

  private async consumeLink(update:PendingUpdate){
    const provider=this.providers.get(update.provider);const tokenHash=update.linkTokenHash!;
    const token=(await this.db.transaction().execute(async tx=>(await sql<{id:string;owner_id:string;school_id:string;portal:Connection['portal'];student_id:string|null}>`
      UPDATE agent_channel_link_tokens SET consumed_at=now() WHERE id=(SELECT id FROM agent_channel_link_tokens
        WHERE provider=${update.provider} AND token_hash=${tokenHash} AND consumed_at IS NULL AND expires_at>now() FOR UPDATE)
      RETURNING id,owner_id,school_id,portal,student_id`.execute(tx)).rows[0]));
    if(!token){await provider.send({externalChatId:update.externalChatId,text:'This connection link is invalid or expired. Generate a new one from OmniSchool Profile.'});await this.terminal(update.id,'ignored');return;}
    const user=await this.user({owner_id:token.owner_id,school_id:token.school_id});
    const thread=await this.agent.createChannelThread(user,randomUUID(),token.portal,token.student_id);
    const connection=await this.db.transaction().execute(async tx=>{
      await sql`UPDATE agent_channel_connections SET state='revoked',revoked_at=now(),revision=revision+1
        WHERE provider=${update.provider} AND state='linked' AND (owner_id=${token.owner_id}::uuid OR external_user_id=${update.externalUserId})`.execute(tx);
      return (await sql<Connection>`INSERT INTO agent_channel_connections(owner_id,school_id,portal,student_id,provider,external_user_id,external_chat_id,agent_thread_id)
        VALUES(${token.owner_id}::uuid,${token.school_id}::uuid,${token.portal},${token.student_id}::uuid,${update.provider},${update.externalUserId},${update.externalChatId},${thread.id}::uuid)
        RETURNING *`.execute(tx)).rows[0]!;
    });
    const message=`Connected to OmniSchool as ${user.first_name||user.username}. You can now ask about the school records and actions available to this account.`;
    const sent=await provider.send({externalChatId:update.externalChatId,text:message});
    await this.recordDelivery(connection,update,'outbound',message,'sent',sent.messageIds.join(','));
    await this.audit(token.owner_id,token.school_id,'agent.channel.linked',randomUUID(),{provider:update.provider,portal:token.portal,connection_id:connection.id});
    await this.terminal(update.id,'delivered',connection.id);
  }

  private async user(connection:Pick<Connection,'owner_id'|'school_id'>):Promise<AuthUser>{
    const row=(await sql<AuthUser>`SELECT id,username,email,first_name,last_name,avatar_url,role,is_active,email_verified_at,
      ${connection.school_id}::uuid AS active_school_id FROM users WHERE id=${connection.owner_id}::uuid AND is_active`.execute(this.db)).rows[0];
    if(!row)throw new ForbiddenException('The linked OmniSchool account is no longer active.');return row;
  }
  private assistantUrl(connection:Connection){
    const base=config().PUBLIC_URL;if(!base)throw new Error('public_url_missing');
    const query=new URLSearchParams({thread:connection.agent_thread_id,...(connection.portal==='parent'&&connection.student_id?{student_id:connection.student_id}:{})});
    return `${base}/${connection.portal}/assistant?${query.toString()}`;
  }
  private async recordDelivery(connection:Connection,update:PendingUpdate,direction:'inbound'|'outbound',content:string,state:'accepted'|'sent'|'failed',providerMessageId=''){
    await sql`INSERT INTO agent_channel_deliveries(connection_id,update_id,direction,provider_message_id,content_hash,character_count,delivery_state)
      VALUES(${connection.id}::uuid,${update.id}::uuid,${direction},${providerMessageId},${hash(content)},${content.length},${state})`.execute(this.db);
  }
  private async terminal(id:string,status:'delivered'|'failed'|'ignored',connectionId?:string,runId?:string){
    await sql`UPDATE agent_channel_updates SET status=${status},message_text=NULL,link_token_hash=NULL,processed_at=now(),lease_expires_at=NULL,
      connection_id=COALESCE(${connectionId??null}::uuid,connection_id),agent_run_id=COALESCE(${runId??null}::uuid,agent_run_id)
      WHERE id=${id}::uuid`.execute(this.db);
  }
  private async retry(update:PendingUpdate,error:unknown){
    const code=error instanceof Error?error.name:'unknown';const final=update.attempts>=5;
    await sql`UPDATE agent_channel_updates SET status=${final?'failed':'pending'},last_error_code=${code.slice(0,80)},lease_expires_at=NULL,
      next_attempt_at=now()+(${Math.min(300,2**update.attempts)}*interval '1 second'),processed_at=CASE WHEN ${final} THEN now() ELSE NULL END,
      message_text=CASE WHEN ${final} THEN NULL ELSE message_text END,
      link_token_hash=CASE WHEN ${final} THEN NULL ELSE link_token_hash END WHERE id=${update.id}::uuid`.execute(this.db);
  }
  private async audit(actorId:string,schoolId:string,action:string,requestId:string,metadata:unknown){
    await sql`INSERT INTO audit_events(action,actor_id,school_id,target_type,request_id,metadata)
      VALUES(${action},${actorId}::uuid,${schoolId}::uuid,'agent_channel',${requestId}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(this.db);
  }
}
