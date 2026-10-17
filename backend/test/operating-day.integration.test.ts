import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { CampusOperatingDayOccurrence } from "../src/campus-model-core/temporal-context.port.js";
import { DatabaseService } from "../src/database/database.service.js";
import { OperatingDayRepository } from "../src/operating-day/operating-day.repository.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true" && Boolean(process.env.DATABASE_URL);
const databaseUrl = isolated
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/unused";

describe.skipIf(!isolated)("operating-day repository integration", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  let database: DatabaseService;
  let repository: OperatingDayRepository;
  let sessionId: string | undefined;

  beforeAll(() => {
    database = new DatabaseService();
    repository = new OperatingDayRepository(database);
  });

  afterAll(async () => {
    if (sessionId) {
      await pool.query("DELETE FROM attendance_session_entries WHERE session_id=$1", [sessionId]);
      await pool.query("DELETE FROM attendance_session_registers WHERE id=$1", [sessionId]);
    }
    await database?.destroy();
    await pool.end();
  });

  it("reads daily and subject-session attendance at their configured grains", async () => {
    const context = (await pool.query<{
      school_id: string;
      class_section_id: string;
      term_id: string;
      subject_id: string;
      schedule_slot_id: string;
      period_number: number;
      starts_at: string;
      ends_at: string;
      student_id: string;
      teacher_id: string;
    }>(`SELECT school.id AS school_id,section.id AS class_section_id,term.id AS term_id,
          subject.id AS subject_id,period.id AS schedule_slot_id,period.period_number,
          period.starts_at::text,period.ends_at::text,enrollment.student_id,period.teacher_user_id AS teacher_id
        FROM schools school
        JOIN academic_terms term ON term.school_id=school.id AND term.is_active
        JOIN class_sections section ON section.school_id=school.id
        JOIN timetable_slots period ON period.class_section_id=section.id AND period.term_id=term.id
          AND period.slot_type='class'
        JOIN subjects subject ON subject.id=period.subject_id
        JOIN enrollments enrollment ON enrollment.class_section_id=section.id AND enrollment.is_active
        WHERE school.code='cis'
        ORDER BY section.grade,section.section,period.period_number
        LIMIT 1`)).rows[0];
    expect(context).toBeTruthy();

    const sessionDate = "2026-10-19";
    const inserted = (await pool.query<{ id: string }>(`INSERT INTO attendance_session_registers(
        school_id,class_section_id,term_id,subject_id,schedule_slot_id,session_date,period_number,
        starts_at,ends_at,title,scheduled_teacher_id,state,revision,submitted_by,submitted_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Integration session',$10,'submitted',1,$10,now())
      ON CONFLICT(school_id,session_date,schedule_slot_id) DO UPDATE SET
        state='submitted',revision=1,submitted_by=EXCLUDED.submitted_by,submitted_at=now()
      RETURNING id`, [
      context!.school_id, context!.class_section_id, context!.term_id, context!.subject_id,
      context!.schedule_slot_id, sessionDate, context!.period_number, context!.starts_at,
      context!.ends_at, context!.teacher_id,
    ])).rows[0];
    sessionId = inserted!.id;
    await pool.query(`INSERT INTO attendance_session_entries(
        school_id,session_id,student_id,status,capture_channel,observed_at,recorded_by,revision
      ) VALUES($1,$2,$3,'present','staff_roll_call',now(),$4,1)
      ON CONFLICT(session_id,student_id) DO UPDATE SET status='present',revision=1`, [
      context!.school_id, sessionId, context!.student_id, context!.teacher_id,
    ]);

    const occurrence: CampusOperatingDayOccurrence = {
      id: randomUUID(), occurrence_id: randomUUID(), occurrence_date: sessionDate,
      period_number: context!.period_number, period_domain_id: context!.schedule_slot_id,
      class_entity_id: randomUUID(), class_domain_id: context!.class_section_id, class_label: "Class",
      subject_entity_id: null, subject_label: "Subject", space_entity_id: null, space_label: null,
      responsible_agent_id: null, responsible_agent_label: null, title: "Subject", slot_type: "class",
      starts_at: `${sessionDate}T03:30:00.000Z`, ends_at: `${sessionDate}T04:15:00.000Z`,
      source_domain: "timetable", source_record_id: context!.schedule_slot_id, source_revision: 1,
      change_kind: "published",
    };

    const sessions = await repository.attendance(context!.school_id, sessionDate, "scheduled_session", [occurrence]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ scope_key: occurrence.id, state: "submitted", revision: 1, marked_count: 1 });
    expect(sessions[0]!.expected_count).toBeGreaterThan(0);

    const daily = await repository.attendance(context!.school_id, "2026-10-16", "daily_class", [occurrence]);
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ scope_key: context!.class_section_id, class_section_id: context!.class_section_id });

    expect(await repository.attendance(context!.school_id, sessionDate, "none", [occurrence])).toEqual([]);
  });
});
