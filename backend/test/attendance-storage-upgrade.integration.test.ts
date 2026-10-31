import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// A deliberately pre-214, disposable fixture. This is an upgrade rehearsal, not
// another permanent database or a second set of runtime business tables.
const enabled = process.env.ATTENDANCE_STORAGE_UPGRADE_TEST_ISOLATED === "true";
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/attendance_upgrade_test",max: 1 });
afterAll(async () => pool.end());
const histories = ["attendance_records","attendance_submissions","attendance_record_revisions","attendance_session_entries",
  "attendance_session_submissions","attendance_session_entry_revisions","attendance_session_evidence","campus_event_attendance_records",
  "campus_event_attendance_revisions","assessment_candidate_attendance"].map(name => `${name}_legacy_source`);
async function foreignKeys(client: PoolClient) {
  return (await client.query(`SELECT source.relname,guard.conname,pg_get_constraintdef(guard.oid) AS definition,
    guard.condeferrable,guard.condeferred,guard.convalidated FROM pg_constraint guard
    JOIN pg_class source ON source.oid=guard.conrelid WHERE guard.contype='f' AND source.relname=ANY($1::text[])
    ORDER BY source.relname,guard.conname`,[histories])).rows;
}
async function refused(client: PoolClient, query: string, values: unknown[], message: RegExp) {
  await client.query("SAVEPOINT refused_operation");
  try { await expect(client.query(query,values)).rejects.toThrow(message); }
  finally { await client.query("ROLLBACK TO SAVEPOINT refused_operation"); }
}

describe.runIf(enabled)("attendance physical-storage upgrade on PostgreSQL 17",() => {
  it("folds nonempty bindings, identities and receipts losslessly while retaining all typed history constraints",async () => {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      expect((await client.query("SELECT to_regclass('activity_attendance_legacy_links') IS NOT NULL AS ready")).rows[0].ready).toBe(true);
      const f=(await client.query(`SELECT student.school_id,student.id AS student_id,student.person_id,enrollment.id AS enrollment_id,
        enrollment.class_section_id,enrollment.term_id,membership.user_id AS actor_id
        FROM students student JOIN enrollments enrollment ON enrollment.student_id=student.id
        JOIN school_memberships membership ON membership.school_id=student.school_id AND membership.role='admin' AND membership.is_active
        WHERE student.person_id IS NOT NULL
        ORDER BY student.id LIMIT 1`)).rows[0] as {school_id:string;student_id:string;person_id:string;enrollment_id:string;
          class_section_id:string;term_id:string;actor_id:string};
      if (!f) throw new Error("The disposable pre-214 seed requires a canonical enrolled learner.");
      const occurrence=randomUUID(),register=randomUUID(),command=randomUUID(),source=`${f.class_section_id}:${f.term_id}:2026-10-21`;
      await client.query(`INSERT INTO schedule_activity_occurrences(id,school_id,activity_id,period_id,source,source_ref,source_revision,title,
        purpose,local_date,starts_at,ends_at,timezone,attendance_mode,context_kind,context_ref,term_id)
        VALUES($1,$2,$3,NULL,'academic',$4,1,'Retained upgrade fixture','teaching','2026-10-21',
          '2026-10-21T00:00:00Z','2026-10-21T23:59:00Z','UTC','roll_call','academic_class',$3,$5)`,
      [occurrence,f.school_id,f.class_section_id,`daily:${source}`,f.term_id]);
      await client.query(`INSERT INTO activity_attendance_registers(id,school_id,occurrence_id,roster_fingerprint,roster_source_revision,
        policy_revision,policy_snapshot) VALUES($1,$2,$3,$4,1,1,'{}')`,[register,f.school_id,occurrence,"a".repeat(64)]);
      await client.query(`INSERT INTO activity_attendance_roster(school_id,register_id,person_id,label,participation_role,requirement,
        source_kind,source_ref,source_revision) VALUES($1,$2,$3,'Retained learner','participant','required','class',$4,1)`,
      [f.school_id,register,f.person_id,f.enrollment_id]);
      await client.query(`INSERT INTO activity_attendance_commands(id,school_id,register_id,actor_id,operation,idempotency_key,request_hash,
        request_id,register_revision,result_body) VALUES($1,$2,$3,$4,'marks',$5,$6,$7,1,'{"native":"unchanged"}')`,
      [command,f.school_id,register,f.actor_id,randomUUID(),"b".repeat(64),randomUUID()]);
      const snapshot={context:{class_id:f.class_section_id,term_id:f.term_id,date:"2026-10-21",legacy_register_id:null},
        attribution:"retained_original_source",unknown_observation_time:null};
      await client.query(`INSERT INTO activity_attendance_legacy_links(school_id,source_kind,source_id,register_id,imported_revision,
        imported_at,state,activated_at,context_snapshot,source_fingerprint)
        VALUES($1,'daily_class',$2,$3,1,'2026-10-21T02:03:04.123456Z','active','2026-10-21T02:03:05.654321Z',$4,$5)`,
      [f.school_id,source,register,JSON.stringify(snapshot),"c".repeat(64)]);
      await client.query(`INSERT INTO activity_attendance_legacy_people(school_id,register_id,person_id,student_id,enrollment_id,source_revision)
        VALUES($1,$2,$3,$4,$5,2)`,[f.school_id,register,f.person_id,f.student_id,f.enrollment_id]);
      await client.query(`INSERT INTO activity_attendance_legacy_command_results(command_id,school_id,source_kind,source_id,legacy_request_hash,
        result_body,records_count,changed_count,capture_source,observed_at,created_at)
        VALUES($1,$2,'daily_class',$3,$4,'{"screen":"exact original receipt"}',1,1,'paper',NULL,'2026-10-21T02:03:06.123456Z')`,
      [command,f.school_id,source,"d".repeat(64)]);
      const before={
        binding:(await client.query("SELECT to_jsonb(source) AS row FROM activity_attendance_legacy_links source WHERE register_id=$1",[register])).rows[0].row,
        identity:(await client.query("SELECT to_jsonb(source) AS row FROM activity_attendance_legacy_people source WHERE register_id=$1",[register])).rows[0].row,
        receipt:(await client.query("SELECT to_jsonb(source) AS row FROM activity_attendance_legacy_command_results source WHERE command_id=$1",[command])).rows[0].row,
        keys:await foreignKeys(client),
      };
      await client.query(await readFile(new URL("../migrations/214_attendance_storage_convergence.sql",import.meta.url),"utf8"));
      expect((await client.query("SELECT to_jsonb(source) AS row FROM activity_attendance_source_contexts source WHERE register_id=$1",[register])).rows[0].row).toEqual(before.binding);
      expect((await client.query("SELECT to_jsonb(source) AS row FROM activity_attendance_academic_roster source WHERE register_id=$1",[register])).rows[0].row).toEqual(before.identity);
      expect((await client.query("SELECT to_jsonb(source) AS row FROM activity_attendance_context_receipts source WHERE command_id=$1",[command])).rows[0].row).toEqual(before.receipt);
      expect(await foreignKeys(client)).toEqual(before.keys);
      expect(before.keys.length).toBeGreaterThan(40);
      expect((await client.query(`SELECT count(*)::int AS count FROM pg_class WHERE relname IN (
        'activity_attendance_legacy_links','activity_attendance_legacy_people','activity_attendance_legacy_command_results',
        'activity_attendance_retained_sources')`)).rows[0].count).toBe(0);
      await client.query("UPDATE activity_attendance_commands SET context_result_body=context_result_body WHERE id=$1",[command]);
      expect((await client.query("SELECT context_result_body FROM activity_attendance_commands WHERE id=$1",[command])).rows[0].context_result_body).toEqual({screen:"exact original receipt"});
      await refused(client,"UPDATE activity_attendance_context_receipts SET result_body='{}' WHERE command_id=$1",[command],/append-only/);
      await refused(client,"UPDATE activity_attendance_commands SET context_result_body='{}' WHERE id=$1",[command],/append-only/);
      await refused(client,"DELETE FROM activity_attendance_commands WHERE id=$1",[command],/append-only/);
      await refused(client,`INSERT INTO activity_attendance_commands(school_id,register_id,actor_id,operation,idempotency_key,request_hash,
        request_id,register_revision,result_body,context_source_kind,context_source_id,context_request_hash,context_result_body,
        context_records_count,context_changed_count,context_capture_source,context_receipt_created_at)
        VALUES($1,$2,$3,'marks',$4,$5,$6,1,'{}','daily_class','foreign-or-invented-source',$5,'{}',1,1,'live_app',now())`,
      [f.school_id,register,f.actor_id,randomUUID(),"e".repeat(64),randomUUID()],/exact command register and institution/);
      await refused(client,"UPDATE activity_attendance_roster SET academic_student_id=gen_random_uuid() WHERE register_id=$1",[register],/canonical person and institution/);
      for (const name of histories) {
        expect((await client.query(`SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid=$1::regclass
          AND tgname='participation_archived_source_immutable' AND tgenabled='O'`,[name])).rows[0].count).toBe(1);
      }
    } finally { await client.query("ROLLBACK");client.release(); }
  },60_000);
});
