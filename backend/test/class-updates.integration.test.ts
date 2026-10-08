import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Kysely, PostgresDialect, sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import { classUpdates } from "../src/school/class-updates.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL), max: 1 }) }) });
afterAll(() => db.destroy());
it("scopes class activity, private replies, terms and unread changes without a student anchor", async () => {
  await db.transaction().execute(async tx => {
    await sql`CREATE TEMP TABLE academic_terms(id uuid,starts_on date,ends_on date) ON COMMIT DROP`.execute(tx);
    await sql`CREATE TEMP TABLE diary_items(id uuid,class_section_id uuid,term_id uuid,author_id uuid,title text,body text,date date,published_at timestamptz) ON COMMIT DROP`.execute(tx);
    await sql`CREATE TEMP TABLE diary_notes(id uuid,item_id uuid,body text,created_at timestamptz) ON COMMIT DROP`.execute(tx);
    await sql`CREATE TEMP TABLE day_plans(id uuid,class_section_id uuid) ON COMMIT DROP`.execute(tx);
    await sql`CREATE TEMP TABLE notifications(id uuid,recipient_id uuid,title text,body text,metadata jsonb,created_at timestamptz,read_at timestamptz) ON COMMIT DROP`.execute(tx);
    const teacher = randomUUID(), otherTeacher = randomUUID(), cls = randomUUID(), otherClass = randomUUID(), term = randomUUID(), oldTerm = randomUUID(), ownItem = randomUUID(), otherItem = randomUUID(), plan = randomUUID();
    const date = (await sql<{date:string}>`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS date`.execute(tx)).rows[0]!.date;
    await sql`INSERT INTO academic_terms VALUES (${term}::uuid,${date}::date-30,${date}::date+30),(${oldTerm}::uuid,${date}::date-90,${date}::date-31)`.execute(tx);
    for (const [id,classId,termId,author,title,published] of [
      [ownItem,cls,term,teacher,"Assigned note",true], [otherItem,cls,term,otherTeacher,"Other teacher note",true],
      [randomUUID(),otherClass,term,teacher,"Wrong class",true], [randomUUID(),cls,oldTerm,teacher,"Wrong term",true],
      [randomUUID(),cls,term,teacher,"Unpublished",false],
    ] as const) await sql`INSERT INTO diary_items VALUES(${id}::uuid,${classId}::uuid,${termId}::uuid,${author}::uuid,${title},'Body',${date}::date,${published ? sql`now()-interval '1 minute'` : sql`NULL`})`.execute(tx);
    await sql`INSERT INTO diary_notes VALUES (${randomUUID()}::uuid,${ownItem}::uuid,'Reply for this teacher',now()),(${randomUUID()}::uuid,${otherItem}::uuid,'Private reply for someone else',now())`.execute(tx);
    await sql`INSERT INTO day_plans VALUES(${plan}::uuid,${cls}::uuid)`.execute(tx);
    for (const recipient of [teacher,otherTeacher]) await sql`INSERT INTO notifications VALUES(${randomUUID()}::uuid,${recipient}::uuid,'Plan updated','Change',${JSON.stringify({day_plan_id:plan})}::jsonb,now(),NULL)`.execute(tx);
    const result = await classUpdates(tx,[cls],teacher,date);
    expect(result.results.map(r=>r.title).sort()).toEqual(["Assigned note","Comment on Assigned note","Other teacher note","Plan updated"].sort());
    expect(result.results.some(r=>r.body.includes("someone else"))).toBe(false);
    expect(result.results.find(r=>r.kind==='change')?.unread).toBe(true);
    await sql`UPDATE notifications SET read_at=now() WHERE recipient_id=${teacher}::uuid`.execute(tx);
    expect((await classUpdates(tx,[cls],teacher,date)).results.find(r=>r.kind==='change')?.unread).toBe(false);
    expect(await classUpdates(tx,[],teacher,date)).toEqual({results:[]});
    expect((await classUpdates(tx,[cls],otherTeacher,date)).results.filter(r=>r.kind==='comment').map(r=>r.body)).toEqual(['Private reply for someone else']);
    await sql`INSERT INTO notifications VALUES(${randomUUID()}::uuid,${teacher}::uuid,'Repeating timetable updated','New term plan',${JSON.stringify({class_section_id:cls,schedule_id:randomUUID()})}::jsonb,now(),NULL)`.execute(tx);
    expect((await classUpdates(tx,[cls],teacher,date)).results.some(r=>r.title==='Repeating timetable updated' && r.unread)).toBe(true);
  });
});
