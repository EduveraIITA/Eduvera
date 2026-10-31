import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../src/database/database.service.js";
import { AgentService } from "../src/agent/agent.service.js";
import { AgentChannelService } from "../src/agent/channels/channel.service.js";
import { MessagingChannelProviderRegistry } from "../src/agent/channels/provider-registry.js";
import { TelegramChannelProvider } from "../src/agent/channels/telegram-provider.js";
import { RolesService } from "../src/roles/roles.service.js";
import type { AgentGateway } from "../src/agent/gateway.js";
import type { AgentMemoryService } from "../src/agent/long-term-memory.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
if (enabled) {
  requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
  // Binding locks must use this disposable database too, never a default Live URL.
  requireIsolatedTestDatabaseUrl(process.env.EVENT_DATABASE_URL ?? process.env.DATABASE_URL);
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!enabled)("external channel binding recovery against current exact identity", () => {
  let db: DatabaseService;
  const services: AgentChannelService[] = [];
  beforeAll(() => { db = new DatabaseService(); });
  afterAll(async () => {
    for (const service of services) await service.onModuleDestroy();
    await db?.destroy();
  });

  async function setup() {
    const f = await createClassPracticeFixture(db);
    await sql`UPDATE users SET pro_features_enabled=true WHERE id=${f.owner.id}::uuid`.execute(db);
    const agent = new AgentService(db, new RolesService(db), f.school, {} as AgentGateway, {} as AgentMemoryService);
    const sent: Array<{ chat_id: string; text: string }> = [];
    const transport = vi.fn<typeof fetch>((_url, init) => {
      if (typeof init?.body !== "string") throw new Error("The fictional transport expects a JSON request body.");
      const payload = JSON.parse(init.body) as { chat_id: string; text: string };
      sent.push(payload);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 }));
    });
    const provider = new TelegramChannelProvider({ enabled: true, token: "fictional-test-token", username: "ThatCampusBot", webhookSecret: "fictional-test-secret" }, transport);
    const registry = new MessagingChannelProviderRegistry(); registry.register(provider);
    const channels = new AgentChannelService(db, agent, registry); services.push(channels);
    const external = `${Date.now()}${randomUUID().slice(0, 8)}`;
    const req = (user: AuthUser) => ({ authUser: user, requestId: randomUUID() }) as AuthenticatedRequest;
    const pending = async (text: string, receivedAt?: string, token: string | null = null) => {
      const row = (await sql<{ id: string }>`INSERT INTO agent_channel_updates(provider,provider_update_id,external_user_id,external_chat_id,
        provider_message_id,sender_label,message_text,link_token_hash,received_at)
        VALUES('telegram',${randomUUID()},${external},${external},'1','Fictional fixture',${text},${token},${receivedAt ? new Date(receivedAt) : new Date()}) RETURNING id`.execute(db)).rows[0]!;
      return { id: row.id, provider: "telegram" as const, updateId: randomUUID(), externalUserId: external, externalChatId: external,
        messageId: "1", senderLabel: "Fictional fixture", text, linkTokenHash: token, attempts: 1 };
    };
    const link = async (user = f.owner) => {
      const hash = digest(randomUUID() + randomUUID());
      await sql`INSERT INTO agent_channel_link_tokens(owner_id,school_id,portal,provider,token_hash,expires_at)
        VALUES(${user.id}::uuid,${user.active_school_id}::uuid,'principal','telegram',${hash},now()+interval '5 minutes')`.execute(db);
      const update = await pending("/start", undefined, hash);
      await channels["process"](update);
      return (await sql<{ id: string; agent_thread_id: string; owner_id: string; state: string }>`SELECT connection.id,connection.agent_thread_id,connection.owner_id,connection.state
        FROM agent_channel_connections connection JOIN agent_channel_updates inbox ON inbox.connection_id=connection.id WHERE inbox.id=${update.id}::uuid`.execute(db)).rows[0]!;
    };
    const answer = async (connection: Awaited<ReturnType<typeof link>>, update: Awaited<ReturnType<typeof pending>>, text = "PRIVATE ANSWER: exact old owner only") => {
      const run = (await sql<{ id: string }>`INSERT INTO agent_runs(thread_id,client_id,question,status,answer,provider,model,finished_at)
        VALUES(${connection.agent_thread_id}::uuid,${update.id}::uuid,${update.text},'completed',${text},'fixture','no-network-model',now()) RETURNING id`.execute(db)).rows[0]!;
      const send = vi.spyOn(agent, "sendFromChannel").mockResolvedValue({ run_id: run.id });
      return { run, send };
    };
    return { f, agent, channels, sent, req, pending, link, answer };
  }

  it("delivers an unchanged exact binding, retaining only its original connection and run", async () => {
    const x = await setup(), connection = await x.link(), update = await x.pending("Please read my authorized record.");
    const { run } = await x.answer(connection, update);
    await x.channels["process"](update);
    expect(x.sent.at(-1)?.text).toBe("PRIVATE ANSWER: exact old owner only");
    expect((await sql`SELECT status,connection_id,agent_run_id,message_text FROM agent_channel_updates WHERE id=${update.id}::uuid`.execute(db)).rows[0])
      .toEqual({ status: "delivered", connection_id: connection.id, agent_run_id: run.id, message_text: null });
  });

  it("sends nothing after revocation while an answer is deferred before provider dispatch", async () => {
    const x = await setup(), connection = await x.link(), update = await x.pending("Private request waiting for a model result.");
    await x.answer(connection, update);
    const reached = deferred(), release = deferred(), currentRun = x.agent.channelRun.bind(x.agent);
    vi.spyOn(x.agent, "channelRun").mockImplementationOnce(async (...args) => {
      reached.resolve(); await release.promise; return currentRun(...args);
    });
    const outcome = x.channels["process"](update).then(() => null, (error: unknown) => error);
    try {
      await reached.promise;
      const before = x.sent.length;
      await x.channels.revoke(x.req(x.f.owner), "telegram");
      release.resolve();
      expect(await outcome).toBeInstanceOf(ForbiddenException);
      expect(x.sent).toHaveLength(before);
      expect((await sql`SELECT count(*)::int AS count FROM agent_channel_outbound_parts WHERE update_id=${update.id}::uuid`.execute(db)).rows[0]).toEqual({ count: 0 });
    } finally { release.resolve(); await outcome; }
  });

  it("does not retarget a queued old answer when the same external identity links to another owner", async () => {
    const x = await setup(), old = await x.link(), update = await x.pending("A private request made under the old binding.");
    const { run, send } = await x.answer(old, update);
    const reached = deferred(), release = deferred(), currentRun = x.agent.channelRun.bind(x.agent);
    vi.spyOn(x.agent, "channelRun").mockImplementationOnce(async (...args) => {
      reached.resolve(); await release.promise; return currentRun(...args);
    });
    const outcome = x.channels["process"](update).then(() => null, (error: unknown) => error);
    try {
      await reached.promise;
      const next = await createClassPracticeFixture(db);
      await sql`UPDATE users SET pro_features_enabled=true WHERE id=${next.owner.id}::uuid`.execute(db);
      const replacement = await x.link(next.owner), before = x.sent.length;
      expect(replacement.owner_id).toBe(next.owner.id); expect(replacement.id).not.toBe(old.id);
      release.resolve(); expect(await outcome).toBeInstanceOf(ForbiddenException); expect(x.sent).toHaveLength(before);
      // A later worker retry must retain, not overwrite, the old context.
      await x.channels["process"](update);
      expect(send).toHaveBeenCalledOnce(); expect(x.sent).toHaveLength(before);
      expect((await sql`SELECT status,connection_id,agent_run_id,message_text FROM agent_channel_updates WHERE id=${update.id}::uuid`.execute(db)).rows[0])
        .toEqual({ status: "ignored", connection_id: old.id, agent_run_id: run.id, message_text: null });
      expect((await sql`SELECT state FROM agent_channel_connections WHERE id=${old.id}::uuid`.execute(db)).rows[0]).toEqual({ state: "revoked" });
    } finally { release.resolve(); await outcome; }
  });

  it("never attaches an inbox older than a binding to that later account", async () => {
    const x = await setup(), update = await x.pending("PRIVATE STALE INBOX: not sent under this future binding.", "2000-01-01T00:00:00.000Z");
    await x.link(); const before = x.sent.length, send = vi.spyOn(x.agent, "sendFromChannel");
    await x.channels["process"](update);
    expect(send).not.toHaveBeenCalled(); expect(x.sent).toHaveLength(before + 1);
    expect(x.sent.at(-1)?.text).toContain("Connect this chat"); expect(x.sent.at(-1)?.text).not.toContain("PRIVATE");
    expect((await sql`SELECT status,connection_id,agent_run_id,message_text FROM agent_channel_updates WHERE id=${update.id}::uuid`.execute(db)).rows[0])
      .toEqual({ status: "ignored", connection_id: null, agent_run_id: null, message_text: null });
  });

  it("scrubs the eighth expired lease, preserving uncertainty instead of silently retrying accepted parts", async () => {
    const x = await setup(), failed = await x.pending("PRIVATE EXHAUSTED INPUT", undefined, digest("fictional exhausted token"));
    const uncertain = await x.pending("PRIVATE UNCERTAIN INPUT", undefined, digest("fictional uncertain token"));
    await sql`UPDATE agent_channel_updates SET status='processing',attempts=8,lease_expires_at=now()-interval '1 minute'
      WHERE id=ANY(${[failed.id, uncertain.id]}::uuid[])`.execute(db);
    await sql`INSERT INTO agent_channel_outbound_parts(update_id,part_index,part_count,content_hash,state,attempts)
      VALUES(${uncertain.id}::uuid,0,1,${digest("fictional retained part")},'sending',1)`.execute(db);
    const send = vi.spyOn(x.agent, "sendFromChannel");
    await x.channels["work"]();
    const rows = (await sql<{ id: string; status: string; message_text: string | null; link_token_hash: string | null; attempts: number; last_error_code: string; processed: boolean }>`
      SELECT id,status,message_text,link_token_hash,attempts,last_error_code,processed_at IS NOT NULL AS processed FROM agent_channel_updates
      WHERE id=ANY(${[failed.id, uncertain.id]}::uuid[])`.execute(db)).rows;
    expect(rows.find(row => row.id === failed.id)).toEqual({ id: failed.id, status: "failed", message_text: null, link_token_hash: null,
      attempts: 8, last_error_code: "expired_exhausted_lease", processed: true });
    expect(rows.find(row => row.id === uncertain.id)).toEqual({ id: uncertain.id, status: "uncertain", message_text: null, link_token_hash: null,
      attempts: 8, last_error_code: "expired_exhausted_lease", processed: true });
    expect(send).not.toHaveBeenCalled(); expect(x.sent).toEqual([]);
  });
});
