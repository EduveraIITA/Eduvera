import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { UncertainChannelDeliveryError } from './provider.js';
export function channelDeliveryCheckpoint(store) {
    return {
        async beforePart(index, count, input) {
            const digest = createHash('sha256').update(JSON.stringify([input.externalChatId, input.text, input.action ?? null])).digest('hex');
            const part = await store.claim(index, count, digest);
            if (part.state === 'uncertain')
                throw new UncertainChannelDeliveryError();
            return part.state === 'sent' ? part.messageId : null;
        },
        accepted: (index, messageId) => store.accepted(index, messageId),
        failed: (index, acceptance) => store.failed(index, acceptance),
    };
}
/** Metadata only. The scoped agent thread owns reply content; no copied transcript. */
export class PostgresChannelPartStore {
    db;
    updateId;
    constructor(db, updateId) {
        this.db = db;
        this.updateId = updateId;
    }
    async claim(index, count, digest) {
        return this.db.transaction().execute(async (tx) => {
            await sql `INSERT INTO agent_channel_outbound_parts(update_id,part_index,part_count,content_hash)
        VALUES(${this.updateId}::uuid,${index},${count},${digest}) ON CONFLICT(update_id,part_index) DO NOTHING`.execute(tx);
            const row = (await sql `
        SELECT state,part_count,content_hash,provider_message_id FROM agent_channel_outbound_parts
        WHERE update_id=${this.updateId}::uuid AND part_index=${index} FOR UPDATE`.execute(tx)).rows[0];
            if (row.content_hash !== digest || row.part_count !== count)
                throw new UncertainChannelDeliveryError();
            if (row.state === 'sent')
                return { state: 'sent', messageId: row.provider_message_id };
            if (row.state === 'sending' || row.state === 'uncertain')
                return { state: 'uncertain', messageId: '' };
            await sql `UPDATE agent_channel_outbound_parts SET state='sending',attempts=attempts+1,updated_at=now()
        WHERE update_id=${this.updateId}::uuid AND part_index=${index}`.execute(tx);
            return { state: 'claimed', messageId: '' };
        });
    }
    async accepted(index, messageId) {
        await sql `UPDATE agent_channel_outbound_parts SET state='sent',provider_message_id=${messageId},updated_at=now()
      WHERE update_id=${this.updateId}::uuid AND part_index=${index} AND state='sending'`.execute(this.db);
    }
    async failed(index, acceptance) {
        await sql `UPDATE agent_channel_outbound_parts SET state=${acceptance === 'rejected' ? 'rejected' : 'uncertain'},updated_at=now()
      WHERE update_id=${this.updateId}::uuid AND part_index=${index} AND state='sending'`.execute(this.db);
    }
}
//# sourceMappingURL=delivery-checkpoint.js.map