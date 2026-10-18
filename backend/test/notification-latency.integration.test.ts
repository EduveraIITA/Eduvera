import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { sql } from 'kysely';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const suite=process.env.TEST_DATABASE_ISOLATED==='true'?describe:describe.skip;
suite('bounded notification reads',()=>{
  let pool:Pool;
  let actor:string;
  let other:string;
  beforeAll(async()=>{
    pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),max:1,statement_timeout:4000});
    for(const target of ['actor','other']){
      const id=randomUUID();
      await pool.query("INSERT INTO users(id,username,email,password_hash,first_name,last_name,role) VALUES($1::uuid,$1::text,$2,'x','Latency','Test','admin')",[id,id+'@example.test']);
      if(target==='actor')actor=id;else other=id;
    }
  });
  afterAll(async()=>{
    if(actor&&other)await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[actor,other]]);
    await pool?.end();
  });
  it('reads a full legacy bell page and unread count within the database deadline',async()=>{
    await pool.query("INSERT INTO notifications(recipient_id,kind,title,body) SELECT $1,'general','Personal alert','Test' FROM generate_series(1,1000)",[actor]);
    const page=await pool.query('SELECT id FROM notifications WHERE recipient_id=$1 AND notification_is_currently_visible(id,$1) ORDER BY created_at DESC,id DESC LIMIT 51',[actor]);
    const count=await pool.query('SELECT count(*)::int total FROM notifications WHERE recipient_id=$1 AND read_at IS NULL AND notification_is_currently_visible(id,$1)',[actor]);
    expect(page.rows).toHaveLength(51);
    expect(count.rows[0].total).toBe(1000);
    expect((await pool.query('SELECT notification_is_currently_visible($1,$2) allowed',[page.rows[0].id,other])).rows[0].allowed).toBe(false);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[actor]);
    expect((await pool.query('SELECT notification_is_currently_visible($1,$2) allowed',[page.rows[0].id,actor])).rows[0].allowed).toBe(false);
    await pool.query('UPDATE users SET is_active=true WHERE id=$1',[actor]);
  });
  it.each(['notice_recipient_id','conversation_id','publication_id','report_batch_id','leave_request_id','student_id','report_id'])('does not grant access to a missing %s source',async key=>{
    const metadata={ [key]:randomUUID(),student_id:randomUUID(),...(key==='report_id'?{notification_scope:'chat_report_review'}:{}) };
    const row=(await pool.query("INSERT INTO notifications(recipient_id,kind,title,body,metadata) VALUES($1,'general','Source alert','Test',$2) RETURNING id",[actor,JSON.stringify(metadata)])).rows[0];
    expect((await pool.query('SELECT notification_is_currently_visible($1,$2) allowed',[row.id,actor])).rows[0].allowed).toBe(false);
  });
  it('retains event-backed fail-closed visibility for a missing event',async()=>{
    const row=(await pool.query("INSERT INTO notifications(recipient_id,kind,title,body,dedupe_key) VALUES($1,'general','Event alert','Test',$2) RETURNING id",[actor,'event:'+randomUUID()])).rows[0];
    expect((await pool.query('SELECT notification_is_currently_visible($1,$2) allowed',[row.id,actor])).rows[0].allowed).toBe(false);
  });
  it('sets a server-side deadline on API database connections',async()=>{
    const db=new DatabaseService();
    try{
      const result=await sql<{statement_timeout:string}>`SHOW statement_timeout`.execute(db);
      expect(result.rows[0]?.statement_timeout).toBe('15s');
    }finally{await db.destroy();}
  });
});
