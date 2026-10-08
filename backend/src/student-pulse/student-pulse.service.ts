import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import type { AuthUser } from '../common/request.js';
import type { Database } from '../database/types.js';
import { DatabaseService } from '../database/database.service.js';
import { schoolPermissionForUser } from '../roles/authorization.js';
import { evaluateSubjects, PULSE_RULE, type SubjectTotal } from './pulse-rules.js';

type Db = Kysely<Database> | Transaction<Database>;
export interface PulseFollowup {
  id: string; student_id: string; class_id: string; term_id: string; subject_id: string;
  owner_user_id: string; owner_name: string; state: 'check_in' | 'monitoring' | 'resolved';
  action: string; due_on: string; outcome: string | null; revision: number;
  baseline_held: number; baseline_attended: number; baseline_excused: number;
  created_at: Date; updated_at: Date;
}
const commandSchema = z.object({
  owner_user_id: z.uuid(), expected_revision: z.number().int().min(0),
  state: z.enum(['check_in','monitoring','resolved']),
  action: z.enum(['private_check_in','academic_support','classroom_review','timetable_review','verify_records']),
  due_on: z.iso.date(), outcome: z.enum(['support_agreed','records_corrected','review_complete']).nullable(),
  records_reviewed: z.literal(true),
}).strict().refine(value => (value.state === 'resolved') === (value.outcome !== null), 'A closed follow-up needs a human-recorded outcome.');

@Injectable()
export class StudentPulseService {
  constructor(private readonly db: DatabaseService) {}
  private async authorize(db: Db, user: AuthUser, school: string) {
    if (!z.uuid().safeParse(school).success) throw new BadRequestException('Choose a valid institution.');
    if (user.active_school_id && user.active_school_id !== school) throw new ForbiddenException('Select this institution before opening Student Pulse.');
    await schoolPermissionForUser(db, user.id, school, 'followups.manage');
  }
  private async totals(db: Db, user: AuthUser, school: string, student: string | null = null) {
    return (await sql<SubjectTotal>`SELECT s.id AS student_id,concat_ws(' ',p.first_name,p.last_name) AS student_name,
      c.id AS class_id,'Class '||c.grade||c.section AS class_name,t.id AS term_id,t.name AS term_name,
      sub.id AS subject_id,sub.name AS subject_name,a.classes_held AS held,a.classes_attended AS attended,a.classes_excused AS excused
      FROM students s JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id
      JOIN enrollments e ON e.student_id=s.id AND e.is_active
      JOIN class_sections c ON c.id=e.class_section_id AND c.school_id=s.school_id
      JOIN academic_terms t ON t.id=e.term_id AND t.school_id=s.school_id
      JOIN schools institution ON institution.id=s.school_id
      JOIN subject_attendance a ON a.student_id=s.id AND a.term_id=t.id
      JOIN subjects sub ON sub.id=a.subject_id AND sub.school_id=s.school_id
      WHERE s.school_id=${school}::uuid AND (now() AT TIME ZONE institution.timezone)::date BETWEEN t.starts_on AND t.ends_on
        AND e.enrolled_on <= (now() AT TIME ZONE institution.timezone)::date
        AND (${student}::uuid IS NULL OR s.id=${student}::uuid)
        AND student_pulse_actor_authorized(${school}::uuid,s.id,c.id,${user.id}::uuid)
      ORDER BY p.first_name,p.last_name,s.id,sub.name`.execute(db)).rows;
  }
  async list(user: AuthUser, school: string) {
    return this.db.transaction().setIsolationLevel('repeatable read').execute(async db => {
      await this.authorize(db,user,school);
      const rows = await this.totals(db,user,school);
      const cases = (await sql<PulseFollowup>`SELECT f.*,concat_ws(' ',u.first_name,u.last_name) AS owner_name
        FROM student_pulse_followups f JOIN users u ON u.id=f.owner_user_id
        WHERE f.school_id=${school}::uuid AND student_pulse_actor_authorized(f.school_id,f.student_id,f.class_id,${user.id}::uuid)`.execute(db)).rows;
      const signals = evaluateSubjects(rows).map(signal => ({...signal,followup:cases.find(f => f.student_id===signal.student_id && f.term_id===signal.term_id && f.subject_id===signal.subject_id) ?? null}))
        .filter(signal => signal.flagged || signal.followup);
      const clock = (await sql<{today:string}>`SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM schools WHERE id=${school}::uuid`.execute(db)).rows[0]!;
      return {school_id:school,today:clock.today,generated_at:new Date().toISOString(),source:'recorded_term_totals',rules:PULSE_RULE,
        unavailable:['dated_period_evidence','between_period_absence','after_lunch_pattern','source_recording_completeness'],signals};
    });
  }
  async detail(user: AuthUser, school: string, student: string, term: string, subject: string) {
    for (const id of [student,term,subject]) if (!z.uuid().safeParse(id).success) throw new BadRequestException('Invalid Student Pulse reference.');
    return this.db.transaction().setIsolationLevel('repeatable read').execute(async db => {
      await this.authorize(db,user,school);
      const signal = evaluateSubjects(await this.totals(db,user,school,student)).find(r=>r.term_id===term&&r.subject_id===subject);
      if (!signal) throw new NotFoundException('This attendance pattern is unavailable or no longer in your assigned scope.');
      const followup = (await sql<PulseFollowup>`SELECT f.*,concat_ws(' ',u.first_name,u.last_name) AS owner_name
        FROM student_pulse_followups f JOIN users u ON u.id=f.owner_user_id
        WHERE f.school_id=${school}::uuid AND f.student_id=${student}::uuid AND f.term_id=${term}::uuid AND f.subject_id=${subject}::uuid`.execute(db)).rows[0] ?? null;
      const owners = (await sql<{id:string;name:string}>`SELECT DISTINCT u.id,concat_ws(' ',u.first_name,u.last_name) AS name
        FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE m.school_id=${school}::uuid AND m.is_active AND m.role IN ('staff','admin')
          AND student_pulse_actor_authorized(${school}::uuid,${student}::uuid,${signal.class_id}::uuid,u.id) ORDER BY name,u.id`.execute(db)).rows;
      const history = followup ? (await sql`SELECT h.revision,h.state,h.action,h.due_on::text,h.outcome,h.created_at,
        concat_ws(' ',u.first_name,u.last_name) AS actor_name,concat_ws(' ',owner.first_name,owner.last_name) AS owner_name
        FROM student_pulse_history h JOIN users u ON u.id=h.actor_id JOIN users owner ON owner.id=h.owner_user_id
        WHERE h.school_id=${school}::uuid AND h.followup_id=${followup.id}::uuid ORDER BY h.revision DESC`.execute(db)).rows : [];
      return {signal,followup,owners,history};
    });
  }
  async save(user: AuthUser, school: string, student: string, term: string, subject: string, body: unknown) {
    const parsed = commandSchema.safeParse(body);
    if (!parsed.success || ![student,term,subject].every(id=>z.uuid().safeParse(id).success)) throw new BadRequestException('Review the records, choose an owner, action, date and a valid outcome.');
    const input = parsed.data;
    await this.db.transaction().execute(async db => {
      await this.authorize(db,user,school);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${school+student+term+subject},0))`.execute(db);
      const signal = evaluateSubjects(await this.totals(db,user,school,student)).find(r=>r.term_id===term&&r.subject_id===subject);
      if (!signal) throw new NotFoundException('This student is not in your current follow-up scope.');
      const current = (await sql<PulseFollowup>`SELECT * FROM student_pulse_followups WHERE school_id=${school}::uuid
        AND student_id=${student}::uuid AND term_id=${term}::uuid AND subject_id=${subject}::uuid FOR UPDATE`.execute(db)).rows[0];
      if ((current?.revision ?? 0) !== input.expected_revision) throw new ConflictException('This follow-up changed. Refresh and review the latest version before saving.');
      if (!current && (!signal.flagged || input.state !== 'check_in')) throw new BadRequestException('Start with a check-in on an attendance gap that needs review.');
      const allowed = (await sql<{allowed:boolean}>`SELECT student_pulse_actor_authorized(${school}::uuid,${student}::uuid,${signal.class_id}::uuid,${input.owner_user_id}::uuid) AS allowed`.execute(db)).rows[0]?.allowed;
      if (!allowed) throw new ForbiddenException('Choose an owner with current follow-up access to this student.');
      const clock = (await sql<{today:string}>`SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM schools WHERE id=${school}::uuid`.execute(db)).rows[0]!;
      if (input.state !== 'resolved' && input.due_on < clock.today) throw new BadRequestException('Choose today or a future review date.');
      const row = (await sql<PulseFollowup>`INSERT INTO student_pulse_followups(school_id,student_id,class_id,term_id,subject_id,
        owner_user_id,state,action,due_on,outcome,baseline_held,baseline_attended,baseline_excused,created_by,updated_by)
        VALUES(${school}::uuid,${student}::uuid,${signal.class_id}::uuid,${term}::uuid,${subject}::uuid,
          ${input.owner_user_id}::uuid,${input.state},${input.action},${input.due_on}::date,${input.outcome},
          ${signal.held},${signal.attended},${signal.excused},${user.id}::uuid,${user.id}::uuid)
        ON CONFLICT(school_id,student_id,term_id,subject_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,
          state=EXCLUDED.state,action=EXCLUDED.action,due_on=EXCLUDED.due_on,outcome=EXCLUDED.outcome,
          updated_by=EXCLUDED.updated_by,updated_at=now(),revision=student_pulse_followups.revision+1 RETURNING *`.execute(db)).rows[0]!;
      await sql`INSERT INTO student_pulse_history(school_id,followup_id,revision,actor_id,state,action,owner_user_id,due_on,outcome)
        VALUES(${school}::uuid,${row.id}::uuid,${row.revision},${user.id}::uuid,${input.state},${input.action},${input.owner_user_id}::uuid,${input.due_on}::date,${input.outcome})`.execute(db);
    });
    return this.detail(user,school,student,term,subject);
  }
}
