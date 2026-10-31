import { createHash } from 'node:crypto';
import { sql,type Kysely } from 'kysely';
import type { Database } from '../../database/types.js';
import { UncertainChannelDeliveryError,type ChannelDeliveryCheckpoint,type ChannelSendInput } from './provider.js';

export interface ChannelPartStore {
  claim(index:number,count:number,digest:string):Promise<{state:'claimed'|'sent'|'uncertain';messageId:string}>;
  accepted(index:number,messageId:string):Promise<void>;
  failed(index:number,acceptance:'rejected'|'unknown'):Promise<void>;
}

export function channelDeliveryCheckpoint(store:ChannelPartStore):ChannelDeliveryCheckpoint {
  return {
    async beforePart(index,count,input:ChannelSendInput){
      const digest=createHash('sha256').update(JSON.stringify([input.externalChatId,input.text,input.action??null])).digest('hex');
      const part=await store.claim(index,count,digest);
      if(part.state==='uncertain')throw new UncertainChannelDeliveryError();
      return part.state==='sent'?part.messageId:null;
    },
    accepted:(index,messageId)=>store.accepted(index,messageId),
    failed:(index,acceptance)=>store.failed(index,acceptance),
  };
}

/** Metadata only. The scoped agent thread owns reply content; no copied transcript. */
export class PostgresChannelPartStore implements ChannelPartStore {
  constructor(private readonly db:Kysely<Database>,private readonly updateId:string){}
  async claim(index:number,count:number,digest:string):Promise<{state:'claimed'|'sent'|'uncertain';messageId:string}>{
    return this.db.transaction().execute(async tx=>{
      await sql`INSERT INTO agent_channel_outbound_parts(update_id,part_index,part_count,content_hash)
        VALUES(${this.updateId}::uuid,${index},${count},${digest}) ON CONFLICT(update_id,part_index) DO NOTHING`.execute(tx);
      const row=(await sql<{state:string;part_count:number;content_hash:string;provider_message_id:string}>`
        SELECT state,part_count,content_hash,provider_message_id FROM agent_channel_outbound_parts
        WHERE update_id=${this.updateId}::uuid AND part_index=${index} FOR UPDATE`.execute(tx)).rows[0]!;
      if(row.content_hash!==digest||row.part_count!==count)throw new UncertainChannelDeliveryError();
      if(row.state==='sent')return {state:'sent',messageId:row.provider_message_id};
      if(row.state==='sending'||row.state==='uncertain')return {state:'uncertain',messageId:''};
      await sql`UPDATE agent_channel_outbound_parts SET state='sending',attempts=attempts+1,updated_at=now()
        WHERE update_id=${this.updateId}::uuid AND part_index=${index}`.execute(tx);
      return {state:'claimed',messageId:''};
    });
  }
  async accepted(index:number,messageId:string){
    await sql`UPDATE agent_channel_outbound_parts SET state='sent',provider_message_id=${messageId},updated_at=now()
      WHERE update_id=${this.updateId}::uuid AND part_index=${index} AND state='sending'`.execute(this.db);
  }
  async failed(index:number,acceptance:'rejected'|'unknown'){
    await sql`UPDATE agent_channel_outbound_parts SET state=${acceptance==='rejected'?'rejected':'uncertain'},updated_at=now()
      WHERE update_id=${this.updateId}::uuid AND part_index=${index} AND state='sending'`.execute(this.db);
  }
}
