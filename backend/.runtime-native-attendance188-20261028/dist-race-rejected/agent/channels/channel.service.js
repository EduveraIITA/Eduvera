var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AgentChannelService_1;
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { assertLiveExternalEffect } from '../../common/simulation-effects.js';
import { config } from '../../config.js';
import { DatabaseService } from '../../database/database.service.js';
import { AgentLimitError } from '../limits.js';
import { AgentService } from '../agent.service.js';
import { ChannelDeliveryError, UncertainChannelDeliveryError } from './provider.js';
import { MessagingChannelProviderRegistry } from './provider-registry.js';
import { channelDeliveryCheckpoint, PostgresChannelPartStore } from './delivery-checkpoint.js';
import { ChannelBindingLease } from './binding-lease.js';
const providerSchema = z.enum(['telegram', 'whatsapp']);
const portalSchema = z.enum(['principal', 'teacher', 'parent', 'student']);
const linkSchema = z.object({ provider: providerSchema, portal: portalSchema, student_id: z.string().uuid().optional() }).strict();
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
let AgentChannelService = AgentChannelService_1 = class AgentChannelService {
    db;
    agent;
    providers;
    timer;
    working = false;
    webhookRetryAt = 0;
    webhookRegistered = false;
    bindingLease = new ChannelBindingLease();
    logger = new Logger(AgentChannelService_1.name);
    constructor(db, agent, providers) {
        this.db = db;
        this.agent = agent;
        this.providers = providers;
    }
    onModuleInit() {
        // Optional integrations must never delay or abort campus application boot.
        const run = () => void this.work().catch(() => this.logger.warn('Channel worker is temporarily unavailable; a bounded retry is scheduled.'));
        this.timer = setInterval(run, config().AGENT_CHANNEL_WORKER_INTERVAL_MS);
        this.timer.unref();
        run();
    }
    async onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); await this.bindingLease.close(); }
    async list(request) {
        assertLiveExternalEffect('External assistant channel administration');
        const connections = (await sql `
      SELECT provider,portal,student_id,linked_at,last_inbound_at,last_outbound_at,
        (SELECT count(*)::int FROM agent_channel_updates inbox WHERE inbox.connection_id=connection.id AND inbox.status='uncertain') AS uncertain_replies
      FROM agent_channel_connections connection
      WHERE owner_id=${request.authUser.id}::uuid AND state='linked' ORDER BY linked_at DESC`.execute(this.db)).rows;
        return { providers: this.providers.list().map(provider => ({ ...provider, connection: connections.find(item => item.provider === provider.name) ?? null })) };
    }
    async issueLink(request) {
        assertLiveExternalEffect('External assistant channel administration');
        const input = linkSchema.parse(request.body);
        const provider = this.providers.get(input.provider);
        if (!provider.configured())
            throw new ConflictException(`${provider.publicIdentity().label} is not configured yet.`);
        if (input.provider !== 'telegram')
            throw new ConflictException('This provider adapter is reserved but not enabled yet.');
        const scope = await this.agent.channelScope(request.authUser, request.requestId, input.portal, input.student_id);
        const raw = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + config().AGENT_CHANNEL_LINK_TTL_MINUTES * 60_000);
        await this.db.transaction().execute(async (tx) => {
            await sql `UPDATE agent_channel_link_tokens SET consumed_at=COALESCE(consumed_at,now())
        WHERE owner_id=${scope.userId}::uuid AND provider=${input.provider} AND consumed_at IS NULL`.execute(tx);
            await sql `INSERT INTO agent_channel_link_tokens(owner_id,school_id,portal,student_id,provider,token_hash,expires_at)
        VALUES(${scope.userId}::uuid,${scope.schoolId}::uuid,${scope.portal},${scope.studentId ?? null}::uuid,${input.provider},${hash(raw)},${expiresAt})`.execute(tx);
        });
        await this.audit(scope.userId, scope.schoolId, 'agent.channel.link_issued', request.requestId, { provider: input.provider, portal: scope.portal, expires_at: expiresAt.toISOString() });
        return { provider: input.provider, connect_url: provider.connectionUrl(raw), expires_at: expiresAt.toISOString() };
    }
    async revoke(request, providerName) {
        assertLiveExternalEffect('External assistant channel administration');
        const provider = providerSchema.parse(providerName);
        const rows = await this.bindingLease.withOwner(provider, request.authUser.id, async () => (await sql `
      UPDATE agent_channel_connections SET state='revoked',revoked_at=now(),revision=revision+1
      WHERE owner_id=${request.authUser.id}::uuid AND provider=${provider} AND state='linked' RETURNING id,school_id`.execute(this.db)).rows);
        if (!rows.length)
            throw new NotFoundException('This messaging connection is not active.');
        await this.audit(request.authUser.id, rows[0].school_id, 'agent.channel.revoked', request.requestId, { provider });
        return { provider, connected: false };
    }
    async ingest(providerName, secret, body) {
        assertLiveExternalEffect('External assistant channel webhook');
        const provider = this.providers.get(providerSchema.parse(providerName));
        const update = provider.parseWebhook(secret, body);
        if (!update)
            return { accepted: true, ignored: true };
        const linkTokenHash = update.linkToken ? hash(update.linkToken) : null;
        await sql `INSERT INTO agent_channel_updates(provider,provider_update_id,external_user_id,external_chat_id,provider_message_id,sender_label,message_text,link_token_hash)
      VALUES(${update.provider},${update.updateId},${update.externalUserId},${update.externalChatId},${update.messageId},${update.senderLabel},${update.linkToken ? '/start' : update.text},${linkTokenHash})
      ON CONFLICT(provider,provider_update_id) DO NOTHING`.execute(this.db);
        return { accepted: true };
    }
    async work() {
        if (this.working)
            return;
        this.working = true;
        try {
            await this.providers.initialize();
            const telegram = this.providers.get('telegram');
            if (config().TELEGRAM_AUTO_REGISTER_WEBHOOK && !this.webhookRegistered && Date.now() >= this.webhookRetryAt && telegram.configured() && telegram.registerWebhook) {
                this.webhookRetryAt = Date.now() + 60_000;
                try {
                    await telegram.registerWebhook();
                    this.webhookRegistered = true;
                }
                catch {
                    this.logger.warn('Telegram webhook setup is temporarily unavailable.');
                }
            }
            if (!this.providers.list().some(provider => provider.configured))
                return;
            await sql `UPDATE agent_channel_updates inbox SET status=CASE WHEN EXISTS(SELECT 1 FROM agent_channel_outbound_parts part
          WHERE part.update_id=inbox.id AND part.state IN ('sending','uncertain')) THEN 'uncertain' ELSE 'failed' END,
        message_text=NULL,link_token_hash=NULL,processed_at=now(),lease_expires_at=NULL,last_error_code='expired_exhausted_lease'
        WHERE inbox.status='processing' AND inbox.lease_expires_at<now() AND inbox.attempts>=8`.execute(this.db);
            await sql `UPDATE agent_channel_updates SET status='pending',lease_expires_at=NULL,next_attempt_at=now()
        WHERE status='processing' AND lease_expires_at<now() AND attempts<8`.execute(this.db);
            const update = await this.db.transaction().execute(async (tx) => (await sql `WITH candidate AS (
          SELECT id FROM agent_channel_updates WHERE status='pending' AND next_attempt_at<=now() ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE agent_channel_updates inbox SET status='processing',attempts=inbox.attempts+1,lease_expires_at=now()+interval '5 minutes'
          FROM candidate WHERE inbox.id=candidate.id RETURNING inbox.id,inbox.provider,inbox.provider_update_id AS "updateId",
          inbox.external_user_id AS "externalUserId",inbox.external_chat_id AS "externalChatId",inbox.provider_message_id AS "messageId",
          inbox.sender_label AS "senderLabel",inbox.message_text AS text,inbox.link_token_hash AS "linkTokenHash",inbox.attempts`.execute(tx)).rows[0]);
            if (!update)
                return;
            try {
                await this.process(update);
            }
            catch (error) {
                await this.retry(update, error);
            }
        }
        finally {
            this.working = false;
        }
    }
    async process(update) {
        if (update.linkTokenHash) {
            await this.consumeLink(update);
            return;
        }
        const retained = (await sql `SELECT connection_id,agent_run_id FROM agent_channel_updates
      WHERE id=${update.id}::uuid`.execute(this.db)).rows[0];
        const connection = (await sql `SELECT * FROM agent_channel_connections WHERE provider=${update.provider}
      AND external_user_id=${update.externalUserId} AND state='linked'
      AND linked_at<=(SELECT received_at FROM agent_channel_updates WHERE id=${update.id}::uuid)
      AND (${retained?.connection_id ?? null}::uuid IS NULL OR id=${retained?.connection_id ?? null}::uuid) LIMIT 1`.execute(this.db)).rows[0];
        if (!connection || connection.external_chat_id !== update.externalChatId) {
            if (!retained?.connection_id)
                await this.send(update, { externalChatId: update.externalChatId, text: 'Connect this chat from ThatCampus Profile → Connected apps before asking about school records.' });
            await this.terminal(update.id, 'ignored');
            return;
        }
        await sql `UPDATE agent_channel_updates SET connection_id=${connection.id}::uuid WHERE id=${update.id}::uuid`.execute(this.db);
        const user = await this.user(connection);
        let runId;
        try {
            runId = retained?.agent_run_id ?? (await this.agent.sendFromChannel(user, randomUUID(), connection.agent_thread_id, update.text, update.id)).run_id;
        }
        catch (error) {
            if (error instanceof ConflictException || error instanceof ForbiddenException || error instanceof AgentLimitError) {
                await this.send(update, { externalChatId: update.externalChatId, text: 'Open ThatCampus to continue this request with your current access.', action: { label: 'Open ThatCampus', url: this.assistantUrl(connection) } }, connection);
                await this.recordDelivery(connection, update, 'outbound', error.message, 'sent');
                await this.terminal(update.id, 'delivered', connection.id);
                return;
            }
            throw error;
        }
        await sql `UPDATE agent_channel_updates SET connection_id=${connection.id}::uuid,agent_run_id=${runId}::uuid WHERE id=${update.id}::uuid`.execute(this.db);
        await this.recordDelivery(connection, update, 'inbound', update.text, 'accepted');
        let result = await this.agent.channelRun(user, randomUUID(), connection.agent_thread_id, runId);
        for (let pass = 0; pass < 235 && ['running'].includes(result.status); pass++) {
            await delay(1000);
            result = await this.agent.channelRun(user, randomUUID(), connection.agent_thread_id, runId);
        }
        if (result.status === 'running')
            throw new Error('agent_timeout');
        const review = ['pending', 'executing', 'uncertain'].includes(result.action?.status ?? '') || result.status === 'confirmation';
        const answer = review ? `${result.answer}\n\nReview this action securely in ThatCampus.` : result.answer;
        const sent = await this.send(update, { externalChatId: update.externalChatId, text: answer, ...(review ? { action: { label: 'Review in ThatCampus', url: this.assistantUrl(connection) } } : {}) }, connection, async (currentUser) => {
            const current = await this.agent.channelRun(currentUser, randomUUID(), connection.agent_thread_id, runId);
            if (current.answer !== result.answer || current.status !== result.status || current.action?.status !== result.action?.status)
                throw new ForbiddenException('The reply or its access changed. Open the current assistant in ThatCampus.');
        });
        await this.recordDelivery(connection, update, 'outbound', answer, 'sent', sent.messageIds.join(','));
        await sql `UPDATE agent_channel_connections SET last_inbound_at=now(),last_outbound_at=now() WHERE id=${connection.id}::uuid`.execute(this.db);
        await this.terminal(update.id, 'delivered', connection.id, runId);
    }
    async consumeLink(update) {
        const tokenHash = update.linkTokenHash;
        let connection = (await sql `SELECT connection.* FROM agent_channel_updates inbox
      JOIN agent_channel_connections connection ON connection.id=inbox.connection_id
      WHERE inbox.id=${update.id}::uuid AND connection.provider=${update.provider}
        AND connection.external_user_id=${update.externalUserId} AND connection.external_chat_id=${update.externalChatId}
        AND connection.state='linked'`.execute(this.db)).rows[0];
        if (!connection) {
            const token = (await sql `
        SELECT id,owner_id,school_id,portal,student_id FROM agent_channel_link_tokens
        WHERE provider=${update.provider} AND token_hash=${tokenHash} AND consumed_at IS NULL AND expires_at>now()`.execute(this.db)).rows[0];
            if (!token) {
                await this.send(update, { externalChatId: update.externalChatId, text: 'This connection link is invalid or expired. Generate a new one from ThatCampus Profile.' });
                await this.terminal(update.id, 'ignored');
                return;
            }
            const user = await this.user(token);
            connection = await this.agent.createChannelThread(user, randomUUID(), token.portal, token.student_id, async (tx, threadId) => {
                const claimed = (await sql `UPDATE agent_channel_link_tokens SET consumed_at=now()
          WHERE id=${token.id}::uuid AND consumed_at IS NULL AND expires_at>now() RETURNING id`.execute(tx)).rows[0];
                if (!claimed)
                    throw new ConflictException('This connection link has already been used or expired.');
                // Serialize both sides of a binding before revoking/replacing it. The
                // unique partial indexes remain the final guard against competing links.
                await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`agent-channel:${update.provider}:external:${update.externalUserId}`},0))`.execute(tx);
                const previous = (await sql `SELECT owner_id FROM agent_channel_connections
          WHERE provider=${update.provider} AND external_user_id=${update.externalUserId} AND state='linked'`.execute(tx)).rows;
                for (const owner of [...new Set([token.owner_id, ...previous.map(row => row.owner_id)])].sort())
                    await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`agent-channel:${update.provider}:owner:${owner}`},0))`.execute(tx);
                await sql `UPDATE agent_channel_connections SET state='revoked',revoked_at=now(),revision=revision+1
          WHERE provider=${update.provider} AND state='linked' AND (owner_id=${token.owner_id}::uuid OR external_user_id=${update.externalUserId})`.execute(tx);
                const linked = (await sql `INSERT INTO agent_channel_connections(owner_id,school_id,portal,student_id,provider,external_user_id,external_chat_id,agent_thread_id)
          VALUES(${token.owner_id}::uuid,${token.school_id}::uuid,${token.portal},${token.student_id}::uuid,${update.provider},${update.externalUserId},${update.externalChatId},${threadId}::uuid)
          RETURNING *`.execute(tx)).rows[0];
                await sql `UPDATE agent_channel_updates SET connection_id=${linked.id}::uuid WHERE id=${update.id}::uuid`.execute(tx);
                await sql `INSERT INTO audit_events(action,actor_id,school_id,target_type,request_id,metadata)
          VALUES('agent.channel.linked',${token.owner_id}::uuid,${token.school_id}::uuid,'agent_channel',${update.id}::uuid,
            ${JSON.stringify({ provider: update.provider, portal: token.portal, connection_id: linked.id })}::jsonb)`.execute(tx);
                return linked;
            });
        }
        const user = await this.user(connection);
        const message = `Connected to ThatCampus as ${user.first_name || user.username}. You can now ask about the school records and actions available to this account.`;
        const sent = await this.send(update, { externalChatId: update.externalChatId, text: message }, connection);
        await this.recordDelivery(connection, update, 'outbound', message, 'sent', sent.messageIds.join(','));
        await this.terminal(update.id, 'delivered', connection.id);
    }
    send(update, input, connection, checkSources) {
        const checkpoint = channelDeliveryCheckpoint(new PostgresChannelPartStore(this.db, update.id));
        if (connection)
            checkpoint.withPart = send => this.bindingLease.withOwner(connection.provider, connection.owner_id, async () => {
                const active = (await sql `SELECT id FROM agent_channel_connections WHERE id=${connection.id}::uuid AND state='linked'
        AND owner_id=${connection.owner_id}::uuid AND school_id=${connection.school_id}::uuid
        AND external_user_id=${update.externalUserId} AND external_chat_id=${update.externalChatId}`.execute(this.db)).rows.length === 1;
                if (!active)
                    throw new ForbiddenException('This messaging connection changed. Nothing further was sent.');
                const currentUser = await this.user(connection);
                await this.agent.channelScope(currentUser, randomUUID(), connection.portal, connection.student_id);
                await checkSources?.(currentUser);
                return send();
            });
        return this.providers.get(update.provider).send(input, checkpoint);
    }
    async user(connection) {
        const row = (await sql `SELECT id,username,email,first_name,last_name,avatar_url,role,is_active,email_verified_at,
      ${connection.school_id}::uuid AS active_school_id FROM users WHERE id=${connection.owner_id}::uuid AND is_active`.execute(this.db)).rows[0];
        if (!row)
            throw new ForbiddenException('The linked ThatCampus account is no longer active.');
        return row;
    }
    assistantUrl(connection) {
        const base = config().PUBLIC_URL;
        if (!base)
            throw new Error('public_url_missing');
        const query = new URLSearchParams({ thread: connection.agent_thread_id, ...(connection.portal === 'parent' && connection.student_id ? { student_id: connection.student_id } : {}) });
        return `${base}/areas/assistant/conversation?${query.toString()}`;
    }
    async recordDelivery(connection, update, direction, content, state, providerMessageId = '') {
        await sql `INSERT INTO agent_channel_deliveries(connection_id,update_id,direction,provider_message_id,content_hash,character_count,delivery_state)
      VALUES(${connection.id}::uuid,${update.id}::uuid,${direction},${providerMessageId},${hash(content)},${content.length},${state})`.execute(this.db);
    }
    async terminal(id, status, connectionId, runId) {
        await sql `UPDATE agent_channel_updates SET status=${status},message_text=NULL,link_token_hash=NULL,processed_at=now(),lease_expires_at=NULL,
      connection_id=COALESCE(${connectionId ?? null}::uuid,connection_id),agent_run_id=COALESCE(${runId ?? null}::uuid,agent_run_id)
      WHERE id=${id}::uuid`.execute(this.db);
    }
    async retry(update, error) {
        const retainedUnknown = (await sql `SELECT update_id FROM agent_channel_outbound_parts WHERE update_id=${update.id}::uuid
      AND state IN ('sending','uncertain') LIMIT 1`.execute(this.db)).rows.length > 0;
        const uncertain = retainedUnknown || error instanceof UncertainChannelDeliveryError || (error instanceof ChannelDeliveryError && error.acceptance === 'unknown');
        if (uncertain) {
            await sql `UPDATE agent_channel_updates SET status='uncertain',last_error_code='delivery_acknowledgement_uncertain',
        message_text=NULL,link_token_hash=NULL,processed_at=now(),lease_expires_at=NULL WHERE id=${update.id}::uuid`.execute(this.db);
            return;
        }
        const code = error instanceof Error ? error.name : 'unknown';
        const final = update.attempts >= 5;
        await sql `UPDATE agent_channel_updates SET status=${final ? 'failed' : 'pending'},last_error_code=${code.slice(0, 80)},lease_expires_at=NULL,
      next_attempt_at=now()+(${Math.min(300, 2 ** update.attempts)}*interval '1 second'),processed_at=CASE WHEN ${final} THEN now() ELSE NULL END,
      message_text=CASE WHEN ${final} THEN NULL ELSE message_text END,
      link_token_hash=CASE WHEN ${final} THEN NULL ELSE link_token_hash END WHERE id=${update.id}::uuid`.execute(this.db);
    }
    async audit(actorId, schoolId, action, requestId, metadata) {
        await sql `INSERT INTO audit_events(action,actor_id,school_id,target_type,request_id,metadata)
      VALUES(${action},${actorId}::uuid,${schoolId}::uuid,'agent_channel',${requestId}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(this.db);
    }
};
AgentChannelService = AgentChannelService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, AgentService, MessagingChannelProviderRegistry])
], AgentChannelService);
export { AgentChannelService };
//# sourceMappingURL=channel.service.js.map