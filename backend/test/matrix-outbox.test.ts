import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'vitest';

// Never run a write test against a database merely because DATABASE_URL exists.
const isolated = process.env.TEST_DATABASE_ISOLATED === 'true' && Boolean(process.env.DATABASE_URL);
describe.skipIf(!isolated)('Matrix transactional outbox', () => {
  let pool: Pool;
  let db: PoolClient;
  let schoolId: string;
  let userId: string;
  let conversationId: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    db = await pool.connect();
    const row = (await db.query<{ school_id: string; user_id: string }>(`SELECT sm.school_id,sm.user_id
      FROM school_memberships sm JOIN users u ON u.id=sm.user_id AND u.is_active
      WHERE sm.is_active AND sm.role='admin' LIMIT 1`)).rows[0];
    assert.ok(row, 'Run the isolated school seeds first');
    schoolId = row.school_id; userId = row.user_id;
  });
  beforeEach(async () => {
    await db.query('BEGIN');
    conversationId = randomUUID();
    await db.query(`INSERT INTO chat_conversations(id,school_id,created_by,title)
      VALUES($1,$2,$3,'Matrix isolated test')`, [conversationId,schoolId,userId]);
    await db.query(`INSERT INTO chat_matrix_schools(school_id,enabled) VALUES($1,false)
      ON CONFLICT(school_id) DO UPDATE SET enabled=false`, [schoolId]);
  });
  afterEach(async () => { await db.query('ROLLBACK'); });
  afterAll(async () => { db?.release(); await pool?.end(); });
  const enable = () => db.query('UPDATE chat_matrix_schools SET enabled=true WHERE school_id=$1', [schoolId]);
  const send = (id = randomUUID()) => db.query<{ id: string }>(`INSERT INTO chat_messages(conversation_id,sender_id,body,client_id)
    VALUES($1,$2,'Original',$3) RETURNING id`, [conversationId,userId,id]);
  const outbox = () => db.query<{ action: string; payload: { body: string }; state: string }>(
    'SELECT action,payload,state FROM chat_matrix_outbox WHERE conversation_id=$1 ORDER BY id', [conversationId]);

  test('disabled schools keep the existing write path without enqueuing Matrix events', async () => {
    await send(); assert.equal((await outbox()).rows.length, 0);
  });
  test('an enabled school atomically queues a pending immutable payload', async () => {
    await enable(); await send();
    const rows = (await outbox()).rows;
    assert.equal(rows.length, 1); assert.ok(rows[0]); assert.equal(rows[0].state, 'pending'); assert.equal(rows[0].payload.body, 'Original');
  });
  test('rolling back message persistence also rolls back the delivery job', async () => {
    await enable(); await db.query('SAVEPOINT sending'); await send();
    await db.query('ROLLBACK TO SAVEPOINT sending'); assert.equal((await outbox()).rows.length, 0);
  });
  test('edits preserve earlier snapshots and deletion queues a redaction', async () => {
    await enable(); const message = (await send()).rows[0]; assert.ok(message); const id = message.id;
    await db.query("UPDATE chat_messages SET body='Edited' WHERE id=$1", [id]);
    await db.query('UPDATE chat_messages SET is_deleted=true WHERE id=$1', [id]);
    const rows = (await outbox()).rows;
    assert.deepEqual(rows.map(row => row.action), ['send','edit','redact']);
    assert.deepEqual(rows.map(row => row.payload.body), ['Original','Edited','Edited']);
  });
  test('duplicate client IDs cannot generate duplicate initial deliveries', async () => {
    await enable(); const clientId = randomUUID(); await send(clientId);
    await db.query('SAVEPOINT duplicate'); await assert.rejects(send(clientId));
    await db.query('ROLLBACK TO SAVEPOINT duplicate'); assert.equal((await outbox()).rows.length, 1);
  });
  test('unrelated timestamp updates do not generate edit events', async () => {
    await enable(); const message = (await send()).rows[0]; assert.ok(message); const id = message.id;
    await db.query('UPDATE chat_messages SET updated_at=now() WHERE id=$1', [id]);
    assert.equal((await outbox()).rows.length, 1);
  });
});
