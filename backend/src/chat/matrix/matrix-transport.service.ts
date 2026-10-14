import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { AuthUser } from '../../common/request.js';
import type { Database } from '../../database/types.js';
import { DatabaseService } from '../../database/database.service.js';
import { MatrixApiError, MatrixClient, matrixSettings, matrixTransactionId } from './matrix-client.js';

type Executor = DatabaseService | Transaction<Database>;
interface Conversation { id: string; school_id: string }
interface OutboxRow {
  id: string; school_id: string; conversation_id: string; message_id: string;
  action: 'send' | 'edit' | 'redact'; attempts: number;
  payload: { body: string; sender_id: string; message_type: string; reply_to_id: string | null; created_at: string };
}
interface Member { user_id: string; name: string }

@Injectable()
export class MatrixTransportService {
  readonly client = new MatrixClient(matrixSettings());
  constructor(private readonly database: DatabaseService) {}

  private async scope(user: AuthUser, conversationId: string, action = 'messages.view'): Promise<Conversation> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) throw new NotFoundException('Conversation not found.');
    const row = (await sql<Conversation>`SELECT c.id,c.school_id FROM chat_conversations c
      WHERE c.id=${conversationId}::uuid
      AND chat_actor_is_current_participant(c.school_id,${user.id}::uuid,${action},c.id)`
      .execute(this.database)).rows[0];
    if (!row) throw new NotFoundException('Conversation not found.');
    return row;
  }
  async status(user: AuthUser, conversationId: string) {
    const conversation = await this.scope(user, conversationId);
    const enabled = await this.isEnabled(conversation.school_id);
    const totals = enabled ? (await sql<{ pending: number; blocked: number }>`
      SELECT count(*) FILTER(WHERE state='pending')::int AS pending,
        count(*) FILTER(WHERE state='blocked')::int AS blocked
      FROM chat_matrix_outbox WHERE conversation_id=${conversationId}::uuid`.execute(this.database)).rows[0]
      : { pending: 0, blocked: 0 };
    return { engine: 'eduvera', bridge: enabled ? 'matrix' : 'disabled', bridge_enabled: enabled, configured: this.client.settings.enabled,
      pending: totals?.pending ?? 0, blocked: totals?.blocked ?? 0,
      // The RTC stack is provisioned separately; do not advertise unverified calls as available.
      calls_enabled: false, end_to_end_encrypted: false };
  }
  private async isEnabled(schoolId: string, db: Executor = this.database): Promise<boolean> {
    if (!this.client.settings.enabled) return false;
    return (await sql<{ enabled: boolean }>`SELECT enabled FROM chat_matrix_schools WHERE school_id=${schoolId}::uuid`.execute(db)).rows[0]?.enabled === true;
  }
  async configureSchool(user: AuthUser, schoolId: string, enabled: boolean) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(schoolId)) throw new BadRequestException('Invalid school.');
    const admin = (await sql<{ allowed: boolean }>`SELECT EXISTS(SELECT 1 FROM school_memberships sm
      JOIN users u ON u.id=sm.user_id AND u.is_active
      WHERE sm.school_id=${schoolId}::uuid AND sm.user_id=${user.id}::uuid AND sm.is_active AND sm.role='admin') AS allowed`
      .execute(this.database)).rows[0]?.allowed;
    if (!admin) throw new ForbiddenException('Only an active administrator of this school can change its chat engine.');
    if (enabled) {
      if (!this.client.settings.enabled) throw new ServiceUnavailableException('The self-hosted Matrix service has not been configured.');
      try { await this.client.request('GET', '/_matrix/client/v3/account/whoami'); }
      catch { throw new ServiceUnavailableException('Matrix authentication/health check failed. Existing chat remains available.'); }
    }
    await this.database.transaction().execute(async tx => {
      await sql`INSERT INTO chat_matrix_schools(school_id,enabled,enabled_at,updated_by)
        VALUES(${schoolId}::uuid,${enabled},CASE WHEN ${enabled} THEN now() ELSE NULL END,${user.id}::uuid)
        ON CONFLICT(school_id) DO UPDATE SET enabled=EXCLUDED.enabled,
          enabled_at=CASE WHEN EXCLUDED.enabled THEN COALESCE(chat_matrix_schools.enabled_at,now()) ELSE chat_matrix_schools.enabled_at END,
          updated_by=EXCLUDED.updated_by,updated_at=now()`.execute(tx);
      await sql`INSERT INTO audit_events(action,actor_id,school_id,target_type,target_id,request_id,metadata)
        VALUES('chat.matrix.configured',${user.id}::uuid,${schoolId}::uuid,'school',${schoolId}::uuid,${randomUUID()},
          ${JSON.stringify({ enabled, history_backfilled: false })}::jsonb)`.execute(tx);
    });
    return { school_id: schoolId, bridge_enabled: enabled, historical_messages_migrated: false };
  }
  async retry(user: AuthUser, conversationId: string) {
    const conversation = await this.scope(user, conversationId, 'messages.send');
    if (!await this.isEnabled(conversation.school_id)) throw new BadRequestException('Matrix is not enabled for this school.');
    // Caller cannot pick an arbitrary school, Matrix room, access token or user to impersonate.
    const result = await sql`UPDATE chat_matrix_outbox SET available_at=now()
      WHERE conversation_id=${conversationId}::uuid AND state='pending'`.execute(this.database);
    return { scheduled: Number(result.numAffectedRows ?? 0), delivered: false };
  }
  async deliveryForMessages(ids: string[]): Promise<Map<string, string>> {
    if (!this.client.settings.enabled || !ids.length) return new Map();
    const rows = (await sql<{ message_id: string; state: string }>`SELECT DISTINCT ON(message_id) message_id,state
      FROM chat_matrix_outbox WHERE message_id=ANY(${ids}::uuid[]) ORDER BY message_id,id DESC`.execute(this.database)).rows;
    return new Map(rows.map(row => [row.message_id,row.state]));
  }
  private async syncMembers(db: Executor, conversation: Conversation, roomId: string): Promise<Set<string>> {
    const rows = (await sql<Member>`SELECT cp.user_id,concat_ws(' ',u.first_name,u.last_name) AS name
      FROM chat_participants cp JOIN users u ON u.id=cp.user_id AND u.is_active
      WHERE cp.conversation_id=${conversation.id}::uuid AND cp.is_active
      AND chat_actor_is_current_participant(${conversation.school_id}::uuid,cp.user_id,'messages.view',${conversation.id}::uuid)`
      .execute(db)).rows;
    const desired = new Set(rows.map(row => this.client.userId(conversation.school_id,row.user_id)));
    const joined = new Set(await this.client.joinedMembers(roomId));
    // Remove revoked access before sending another event, including dropped class/guardian relationships.
    for (const id of joined) if (id !== this.client.botId && !desired.has(id)) await this.client.kick(roomId,id);
    for (const row of rows) {
      const id = this.client.userId(conversation.school_id,row.user_id);
      if (!joined.has(id)) {
        await this.client.join(roomId,id);
        await this.client.request('PUT',`/_matrix/client/v3/profile/${encodeURIComponent(id)}/displayname`,{ displayname: row.name },id);
      }
    }
    return desired;
  }
  private async room(db: Executor, conversation: Conversation): Promise<string> {
    const existing = (await sql<{ matrix_room_id: string }>`SELECT matrix_room_id FROM chat_matrix_rooms
      WHERE conversation_id=${conversation.id}::uuid AND school_id=${conversation.school_id}::uuid`.execute(db)).rows[0];
    if (existing) return existing.matrix_room_id;
    const roomId = await this.client.ensureRoom(conversation.school_id,conversation.id);
    await sql`INSERT INTO chat_matrix_rooms(conversation_id,school_id,matrix_room_id)
      VALUES(${conversation.id}::uuid,${conversation.school_id}::uuid,${roomId})
      ON CONFLICT(conversation_id) DO NOTHING`.execute(db);
    return roomId;
  }
  async drainPending(limit = 20): Promise<number> {
    if (!this.client.settings.enabled) return 0;
    const conversations = (await sql<{ conversation_id: string }>`SELECT o.conversation_id
      FROM chat_matrix_outbox o JOIN chat_matrix_schools s ON s.school_id=o.school_id AND s.enabled
      WHERE o.state='pending' AND o.available_at<=now()
      GROUP BY o.conversation_id ORDER BY min(o.id) LIMIT ${Math.min(Math.max(limit,1),100)}`.execute(this.database)).rows;
    let delivered = 0;
    for (const row of conversations) delivered += (await this.flushConversation(row.conversation_id,20)).delivered;
    return delivered;
  }
  async flushConversation(conversationId: string, limit = 3) {
    if (!this.client.settings.enabled) return { delivered: 0, pending: false };
    let delivered = 0;
    // One transaction/advisory lock per conversation preserves event ordering across Cloud Run replicas.
    // A crash after Matrix accepts an event is safe: its deterministic transaction ID deduplicates retry.
    await this.database.transaction().execute(async tx => {
      const locked = (await sql<{ locked: boolean }>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`matrix:${conversationId}`},0)) AS locked`.execute(tx)).rows[0]?.locked;
      if (!locked) return;
      const conversation = (await sql<Conversation>`SELECT id,school_id FROM chat_conversations WHERE id=${conversationId}::uuid`.execute(tx)).rows[0];
      if (!conversation || !await this.isEnabled(conversation.school_id,tx)) return;
      const rows = (await sql<OutboxRow>`SELECT * FROM chat_matrix_outbox WHERE conversation_id=${conversationId}::uuid
        AND state='pending' ORDER BY id LIMIT ${Math.min(Math.max(limit,1),20)} FOR UPDATE`.execute(tx)).rows;
      let roomId: string | undefined;
      let members: Set<string> | undefined;
      for (const row of rows) {
        const due = (await sql<{ due: boolean }>`SELECT available_at<=now() AS due FROM chat_matrix_outbox WHERE id=${row.id}::bigint`.execute(tx)).rows[0]?.due;
        if (!due) break;
        try {
          roomId ??= await this.room(tx,conversation);
          members ??= await this.syncMembers(tx,conversation,roomId);
          const sender = this.client.userId(row.school_id,row.payload.sender_id);
          const allowed = (await sql<{ allowed: boolean; deleted: boolean }>`SELECT
            chat_actor_is_current_participant(${row.school_id}::uuid,${row.payload.sender_id}::uuid,'messages.send',${conversationId}::uuid)
              AND NOT EXISTS(SELECT 1 FROM chat_messaging_restrictions r WHERE r.school_id=${row.school_id}::uuid
                AND r.user_id=${row.payload.sender_id}::uuid AND r.revoked_at IS NULL AND r.expires_at>now()) AS allowed,
            m.is_deleted AS deleted FROM chat_messages m WHERE m.id=${row.message_id}::uuid`.execute(tx)).rows[0];
          if (row.action !== 'redact' && (!members.has(sender) || !allowed?.allowed || allowed.deleted)) {
            await sql`UPDATE chat_matrix_outbox SET state='blocked',last_error_code=${allowed?.deleted ? 'REMOVED_BEFORE_DELIVERY' : 'ACCESS_REVOKED'} WHERE id=${row.id}::bigint`.execute(tx);
            continue;
          }
          const first = (await sql<{ matrix_event_id: string | null }>`SELECT matrix_event_id FROM chat_matrix_outbox
            WHERE message_id=${row.message_id}::uuid AND action='send' AND state='delivered'`.execute(tx)).rows[0]?.matrix_event_id;
          const txn = matrixTransactionId(row.id);
          let eventId: string | undefined;
          if (row.action === 'redact') {
            // Redact every delivered edit as well as the initial event: edits also contain plaintext.
            const versions = (await sql<{ matrix_event_id: string }>`SELECT matrix_event_id FROM chat_matrix_outbox
              WHERE message_id=${row.message_id}::uuid AND state='delivered' AND matrix_event_id IS NOT NULL
              AND action IN ('send','edit') ORDER BY id`.execute(tx)).rows;
            for (const version of versions) await this.client.redact(roomId,version.matrix_event_id,
              matrixTransactionId(`${row.id}:${version.matrix_event_id}`));
          } else {
            if (row.action === 'edit' && !first) {
              await sql`UPDATE chat_matrix_outbox SET state='blocked',last_error_code='ORIGINAL_NOT_DELIVERED' WHERE id=${row.id}::bigint`.execute(tx);
              continue;
            }
            const attachment = (await sql<{ id: string; original_name: string; content_type: string; size_bytes: number }>`
              SELECT id,original_name,content_type,size_bytes FROM chat_attachments WHERE message_id=${row.message_id}::uuid`.execute(tx)).rows[0];
            const text = row.payload.body || (attachment ? `Attachment: ${attachment.original_name}` : '');
            const content: Record<string,unknown> = {
              msgtype: 'm.text', body: text,
              'io.eduvera.message_id': row.message_id,
              'io.eduvera.original_created_at': row.payload.created_at,
              // Keep files behind Eduvera's conversation-scoped authorization, not public mxc URLs.
              ...(attachment ? { 'io.eduvera.attachment': { ...attachment,
                url: `/api/v1/chat/conversations/${row.conversation_id}/messages/${row.message_id}/attachment/` } } : {}),
            };
            if (row.payload.reply_to_id) {
              const reply = (await sql<{ matrix_event_id: string }>`SELECT matrix_event_id FROM chat_matrix_outbox
                WHERE message_id=${row.payload.reply_to_id}::uuid AND conversation_id=${conversationId}::uuid
                AND action='send' AND state='delivered'`.execute(tx)).rows[0];
              if (reply) content['m.relates_to'] = { 'm.in_reply_to': { event_id: reply.matrix_event_id } };
            }
            const eventContent = row.action === 'edit' ? { ...content, body: `* ${text}`,
              'm.new_content': content, 'm.relates_to': { rel_type: 'm.replace', event_id: first } } : content;
            eventId = await this.client.send(roomId,sender,txn,eventContent);
          }
          await sql`UPDATE chat_matrix_outbox SET state='delivered',matrix_event_id=${eventId ?? null},
            attempts=attempts+1,last_error_code=NULL,delivered_at=now() WHERE id=${row.id}::bigint`.execute(tx);
          delivered++;
        } catch (error) {
          const code = error instanceof MatrixApiError ? error.code : 'M_TRANSPORT_ERROR';
          const seconds = Math.min(3600,2 ** Math.min(row.attempts + 1,11));
          await sql`UPDATE chat_matrix_outbox SET attempts=attempts+1,last_error_code=${code},
            available_at=now()+(${seconds}::int * interval '1 second') WHERE id=${row.id}::bigint`.execute(tx);
          break; // Never overtake a failed earlier event in the same conversation.
        }
      }
    });
    return { delivered };
  }
}
