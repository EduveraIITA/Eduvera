import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../database/types.js';
import type { DatabaseService } from '../database/database.service.js';
import type { ActivityOccurrence, ActivityParticipant } from './activity.contracts.js';
import type { HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import type { ResponsibilityProjectionPort } from '../campus-model-core/responsibility-projection.port.js';
import { recurrenceDays, isAmbiguousLocalInstant } from './shared-recurrence.js';

export type PlanningDb = DatabaseService | Transaction<Database>;
/** Internal projection scope; omitted means every canonical source family. */
export interface ActivityOccurrenceQuery { source?: 'activity' }

/** Stable domain identity, not a writable Live/Core identity or random projection ID. */
export function activityOccurrenceId(school: string, source: string, reference: string, date: string) {
  const bytes = createHash('sha256').update(JSON.stringify([school, source, reference, date])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function occurrenceConflict(a: ActivityOccurrence, b: ActivityOccurrence) {
  if (a.id === b.id || a.state !== 'expected' || b.state !== 'expected'
    || a.starts_at >= b.ends_at || b.starts_at >= a.ends_at) return null;
  const people = new Set(a.participants.filter(person => person.requirement === 'required').map(person => person.person_id));
  const person = b.participants.find(candidate => candidate.requirement === 'required' && people.has(candidate.person_id));
  if (person) return { kind: 'person', person_id: person.person_id, label: person.label };
  if (a.space_id && a.space_id === b.space_id) return { kind: 'space', space_id: a.space_id, label: a.space_label ?? 'Selected place' };
  return null;
}

/** Check only concurrent canonical claims, not every date against every date. */
export function firstOccurrenceConflict(proposed: ActivityOccurrence[], existing: ActivityOccurrence[]) {
  const changed=new Set(proposed.map(occurrence=>occurrence.id));
  const combined=new Map([...existing,...proposed].filter(occurrence=>occurrence.state==='expected').map(occurrence=>[occurrence.id,occurrence]));
  const ordered=[...combined.values()].sort((left,right)=>left.starts_at.localeCompare(right.starts_at)||left.id.localeCompare(right.id));
  const keys=(occurrence:ActivityOccurrence)=>[...occurrence.participants.filter(person=>person.requirement==='required').map(person=>`person:${person.person_id}`),
    ...(occurrence.space_id?[`space:${occurrence.space_id}`]:[])];
  const claims=new Map<string,Set<ActivityOccurrence>>();
  let active:ActivityOccurrence[]=[];
  for(const occurrence of ordered){
    active=active.filter(other=>{
      if(other.ends_at>occurrence.starts_at)return true;
      for(const key of keys(other)){const claim=claims.get(key);claim?.delete(other);if(claim?.size===0)claims.delete(key);}
      return false;
    });
    for(const key of keys(occurrence))for(const other of claims.get(key)??[]){
      if(!changed.has(occurrence.id)&&!changed.has(other.id))continue;
      const target=changed.has(occurrence.id)?occurrence:other,previous=target===occurrence?other:occurrence;
      const conflict=occurrenceConflict(target,previous);
      if(conflict)return {occurrence:target,other:previous,conflict};
    }
    for(const key of keys(occurrence)){const claim=claims.get(key)??new Set<ActivityOccurrence>();claim.add(occurrence);claims.set(key,claim);}
    active.push(occurrence);
  }
  return null;
}

/** Validate declared wall-time recurrences at clock-change boundaries too. */
export function timezoneTransitionDates(timezone:string,from:string,days=370){
  const format=new Intl.DateTimeFormat('en',{timeZone:timezone,timeZoneName:'longOffset'});
  const offset=(at:Date)=>format.formatToParts(at).find(part=>part.type==='timeZoneName')?.value;
  const start=Date.parse(`${from}T12:00:00Z`),boundaries:string[]=[];
  let previous=offset(new Date(start-86400000));
  for(let day=0;day<=days;day++){
    const at=new Date(start+day*86400000),current=offset(at);
    if(current!==previous)boundaries.push(new Date(at.getTime()-86400000).toISOString().slice(0,10));
    previous=current;
  }
  return boundaries;
}

type RawOccurrence = Omit<ActivityOccurrence, 'participants' | 'id' | 'starts_at' | 'ends_at'> & {
  starts_at: Date | string; ends_at: Date | string; gap: boolean;
};

/**
 * The single domain expansion/roster boundary. Old academic schedules are an
 * adapter over effective_school_schedule_v4 (including its closures, overrides
 * and accepted coverage), never copied into a second authored schedule.
 */
export class ActivityOccurrenceEngine {
  constructor(private readonly identities: HumanAgentIdentityPort, private readonly responsibilities: ResponsibilityProjectionPort) {}
  async expand(db: PlanningDb, schoolId: string, from: string, until: string, includeDraftId?: string, query: ActivityOccurrenceQuery = {}): Promise<ActivityOccurrence[]> {
    const activityOnly = query.source === 'activity';
    const raw = (await sql<RawOccurrence>`
      WITH activity AS (
        SELECT version.id AS activity_id,version.id AS plan_version_id,period.id AS period_id,
          'activity'::text AS source,concat(version.id::text,':',period.id::text) AS source_ref,
          version.revision AS source_revision,version.activity_title AS title,
          version.activity_purpose AS purpose,day::date::text AS local_date,
          ((day::date+period.starts_at) AT TIME ZONE version.activity_timezone) AS starts_at,
          ((day::date+period.end_day_offset+period.ends_at) AT TIME ZONE version.activity_timezone) AS ends_at,
          version.activity_timezone AS timezone,period.space_id,COALESCE(NULLIF(period.room,''),space.name) AS space_label,
          version.attendance_mode,
          CASE WHEN version.class_section_id IS NULL THEN 'activity' ELSE 'academic_class' END AS context_kind,
          version.class_section_id AS context_ref,version.term_id,period.subject_id,
          period.teacher_user_id AS scheduled_teacher_id,period.period_number,
          CASE WHEN (version.state='cancelled' AND ((day::date+period.starts_at) AT TIME ZONE version.activity_timezone)>=version.cancelled_at)
            OR EXISTS(SELECT 1 FROM schedule_plan_supersessions supersession WHERE supersession.previous_version_id=version.id
              AND ((day::date+period.starts_at) AT TIME ZONE version.activity_timezone)>=supersession.effective_from
              AND (supersession.effective_until IS NULL OR ((day::date+period.starts_at) AT TIME ZONE version.activity_timezone)<supersession.effective_until))
            THEN 'cancelled' ELSE 'expected' END AS state,1 AS revision,
          version.recorder_person_id,version.reviewer_person_id,
          version.location_kind,version.location_label,version.location_url,
          (((day::date+period.starts_at) AT TIME ZONE version.activity_timezone) AT TIME ZONE version.activity_timezone)<>(day::date+period.starts_at)
            OR (((day::date+period.end_day_offset+period.ends_at) AT TIME ZONE version.activity_timezone) AT TIME ZONE version.activity_timezone)<>(day::date+period.end_day_offset+period.ends_at) AS gap
        FROM schedule_versions version JOIN schedule_periods period ON period.version_id=version.id
        LEFT JOIN campus_spaces space ON space.id=period.space_id AND space.school_id=version.school_id
        CROSS JOIN LATERAL ${recurrenceDays({startsOn:sql`version.starts_on`,endsOn:sql`version.ends_on`,from:sql`${from}`,until:sql`${until}`,weekday:sql`period.weekday`,kind:sql`version.recurrence_kind`})} day
        WHERE version.school_id=${schoolId}::uuid AND version.planning_origin='activity'
          AND (version.state IN ('published','cancelled') OR version.id=${includeDraftId ?? null}::uuid)
      ), academic AS (
        SELECT COALESCE(schedule.source_record_id,schedule.id) AS activity_id,
          CASE WHEN schedule.source_kind='published_timetable' THEN schedule.source_record_id ELSE NULL::uuid END AS plan_version_id,
          schedule.id AS period_id,'academic'::text AS source,
          concat(schedule.class_section_id::text,':',schedule.id::text,':',schedule.source_kind,':',schedule.source_record_id::text,':',schedule.source_revision::text) AS source_ref,
          GREATEST(COALESCE(schedule.source_revision,1),1) AS source_revision,schedule.title,
          'teaching'::text AS purpose,day::date::text AS local_date,
          ((day::date+schedule.starts_at) AT TIME ZONE school.timezone) AS starts_at,
          ((day::date+schedule.ends_at) AT TIME ZONE school.timezone) AS ends_at,
          school.timezone,schedule.space_id,space.name AS space_label,
          CASE WHEN rules.attendance_academic_mode='none' OR schedule.slot_type<>'class' THEN 'none' ELSE 'roll_call' END AS attendance_mode,
          'academic_class'::text AS context_kind,schedule.class_section_id AS context_ref,
          schedule.term_id,schedule.subject_id,schedule.teacher_user_id AS scheduled_teacher_id,schedule.period_number,
          CASE WHEN schedule.cancelled THEN 'cancelled' ELSE 'expected' END AS state,1 AS revision,
          NULL::uuid AS recorder_person_id,NULL::uuid AS reviewer_person_id,
          (((day::date+schedule.starts_at) AT TIME ZONE school.timezone) AT TIME ZONE school.timezone)<>(day::date+schedule.starts_at)
            OR (((day::date+schedule.ends_at) AT TIME ZONE school.timezone) AT TIME ZONE school.timezone)<>(day::date+schedule.ends_at) AS gap
          ,CASE WHEN schedule.space_id IS NULL THEN 'unspecified' ELSE 'on_campus' END AS location_kind,
          ''::text AS location_label,''::text AS location_url
        FROM schools school
        LEFT JOIN institution_operating_rules rules ON rules.school_id=school.id
        CROSS JOIN LATERAL generate_series(${from}::date-1,${until}::date,interval '1 day') day
        CROSS JOIN LATERAL effective_school_schedule_v4(school.id,day::date) schedule
        LEFT JOIN campus_spaces space ON space.id=schedule.space_id AND space.school_id=school.id
        LEFT JOIN schedule_versions version ON version.id=schedule.source_record_id AND schedule.source_kind='published_timetable'
        WHERE ${activityOnly ? sql`false` : sql`true`} AND school.id=${schoolId}::uuid AND COALESCE(version.planning_origin,'academic')='academic'
          AND schedule.slot_type<>'break'
      )
      SELECT ${schoolId}::uuid AS school_id,combined.* FROM (
        SELECT activity_id,plan_version_id,period_id,source,source_ref,source_revision,title,purpose,local_date,starts_at,ends_at,timezone,
          space_id,space_label,attendance_mode,context_kind,context_ref,term_id,subject_id,scheduled_teacher_id,period_number,state,revision,
          recorder_person_id,reviewer_person_id,location_kind,location_label,location_url,gap FROM activity
        ${activityOnly ? sql`` : sql`UNION ALL
        SELECT activity_id,plan_version_id,period_id,source,source_ref,source_revision,title,purpose,local_date,starts_at,ends_at,timezone,
          space_id,space_label,attendance_mode,context_kind,context_ref,term_id,subject_id,scheduled_teacher_id,period_number,state,revision,
          recorder_person_id,reviewer_person_id,location_kind,location_label,location_url,gap FROM academic`}
      ) combined
      WHERE ends_at>(${from}::date::timestamp AT TIME ZONE timezone)
        AND starts_at<((${until}::date+1)::timestamp AT TIME ZONE timezone)
        AND (source<>'activity' OR state<>'cancelled' OR EXISTS(
          SELECT 1 FROM schedule_activity_occurrences retained WHERE retained.school_id=${schoolId}::uuid
            AND retained.source=combined.source AND retained.source_ref=combined.source_ref AND retained.local_date=combined.local_date::date))
      ORDER BY starts_at,title,source_ref
    `.execute(db)).rows;
    const result: ActivityOccurrence[] = [];
    for (const row of raw) {
      if (row.plan_version_id === includeDraftId && (row.gap || isAmbiguousLocalInstant(new Date(row.starts_at).toISOString(), row.timezone)
        || isAmbiguousLocalInstant(new Date(row.ends_at).toISOString(), row.timezone)))
        throw new BadRequestException(`The time on ${row.local_date} does not identify one existing instant because of a daylight-saving clock change. Choose an unambiguous local time.`);
      const id = activityOccurrenceId(schoolId, row.source, row.source_ref, row.local_date);
      const participants = row.source === 'activity'
        ? await this.activityPeople(db, schoolId, row.plan_version_id!, row.local_date, new Date(row.starts_at).toISOString())
        : await this.academicPeople(db, schoolId, row.context_ref!, row.term_id!, row.local_date, row.scheduled_teacher_id, new Date(row.starts_at).toISOString());
      result.push({ ...row, id, starts_at: new Date(row.starts_at).toISOString(), ends_at: new Date(row.ends_at).toISOString(), participants });
    }
    // Other domains publish their authoritative, already-expanded footprint into
    // this same occurrence store. No second event/examination editor or repeat
    // rule is inferred here; their adapters retain eligibility and lifecycle.
    const owned=activityOnly ? [] : (await sql<Omit<ActivityOccurrence,'participants'> & {starts_at:Date|string;ends_at:Date|string}>`SELECT occurrence.*,
      occurrence.local_date::text,space.name AS space_label,NULL::uuid AS recorder_person_id,NULL::uuid AS reviewer_person_id
      FROM schedule_activity_occurrences occurrence LEFT JOIN campus_spaces space ON space.id=occurrence.space_id AND space.school_id=occurrence.school_id
      WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.source IN ('event','examination')
        AND occurrence.ends_at>(${from}::date::timestamp AT TIME ZONE occurrence.timezone)
        AND occurrence.starts_at<((${until}::date+1)::timestamp AT TIME ZONE occurrence.timezone)
      ORDER BY occurrence.starts_at,occurrence.id`.execute(db)).rows;
    for(const row of owned){
      const participants=(await sql<ActivityParticipant>`SELECT person_id,label,participation_role,source_kind,source_ref,source_revision,person_revision,requirement,attendance_expected
        FROM schedule_activity_occurrence_people WHERE school_id=${schoolId}::uuid AND occurrence_id=${row.id}::uuid ORDER BY person_id`.execute(db)).rows;
      result.push({...row,starts_at:new Date(row.starts_at).toISOString(),ends_at:new Date(row.ends_at).toISOString(),participants});
    }
    return result.sort((left,right)=>left.starts_at.localeCompare(right.starts_at)||left.id.localeCompare(right.id));
  }

  async activityPeople(db: PlanningDb, schoolId: string, versionId: string, date: string, at: string): Promise<ActivityParticipant[]> {
    const captured = (await sql`SELECT version_id FROM schedule_plan_publication_evidence WHERE version_id=${versionId}::uuid AND school_id=${schoolId}::uuid`.execute(db)).rows[0];
    // A retained lead claim proves a scheduling commitment, not enrolment. Use
    // only captured sources and immutable explicit selections, never today's
    // group membership, to retain legitimate overlapping participant roles.
    if (captured) return (await sql<ActivityParticipant>`SELECT DISTINCT ON(source.person_id) source.person_id,source.label,source.participation_role,
        source.source_kind,source.source_ref,source.source_revision,source.person_revision,'required'::text AS requirement,
        bool_or(source.source_kind<>'person' OR source.participation_role<>'lead' OR selected.person_id IS NOT NULL)
          OVER(PARTITION BY source.person_id) AS attendance_expected
      FROM schedule_plan_roster_sources source LEFT JOIN schedule_plan_people selected
        ON selected.version_id=source.version_id AND selected.school_id=source.school_id AND selected.person_id=source.person_id
      WHERE source.version_id=${versionId}::uuid AND source.school_id=${schoolId}::uuid
        AND source.effective_from<=${at}::timestamptz AND (source.effective_until IS NULL OR source.effective_until>${at}::timestamptz)
      ORDER BY source.person_id,(source.participation_role='lead') DESC,source.source_kind,source.source_ref`.execute(db)).rows;
    const people = (await sql<ActivityParticipant>`
      WITH expected AS (
        SELECT selected.person_id,'person'::text AS source_kind,selected.person_id::text AS source_ref,person.revision AS source_revision,true AS attendance_expected
        FROM schedule_plan_people selected JOIN school_people person ON person.id=selected.person_id AND person.school_id=selected.school_id
        WHERE selected.version_id=${versionId}::uuid AND selected.school_id=${schoolId}::uuid
        UNION ALL
        SELECT student.person_id,'class',enrollment.id::text,1,true FROM schedule_plan_groups selected
        JOIN enrollments enrollment ON enrollment.class_section_id=selected.group_id
        JOIN academic_terms term ON term.id=enrollment.term_id AND ${date}::date BETWEEN term.starts_on AND term.ends_on
        JOIN students student ON student.id=enrollment.student_id AND student.school_id=selected.school_id
        WHERE selected.version_id=${versionId}::uuid AND selected.school_id=${schoolId}::uuid AND selected.group_kind='class'
          AND enrollment.enrolled_on<=${date}::date AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${date}::date)
        UNION ALL
        SELECT membership.person_id,'group',membership.id::text,membership.revision,true
        FROM schedule_plan_groups selected JOIN participation_group_members membership
          ON membership.group_id=selected.group_id AND membership.school_id=selected.school_id
        JOIN participation_groups participant_group ON participant_group.id=membership.group_id AND participant_group.is_active
        WHERE selected.version_id=${versionId}::uuid AND selected.school_id=${schoolId}::uuid AND selected.group_kind='group'
          AND membership.starts_on<=${date}::date AND (membership.ends_on IS NULL OR membership.ends_on>=${date}::date)
        UNION ALL
        SELECT lead_person_id,'person',lead_person_id::text,person.revision,false FROM schedule_versions version
        JOIN school_people person ON person.id=version.lead_person_id AND person.school_id=version.school_id
        WHERE version.id=${versionId}::uuid AND version.school_id=${schoolId}::uuid
        UNION ALL
        SELECT student.person_id,'class',enrollment.id::text,1,true FROM schedule_versions version
        JOIN enrollments enrollment ON enrollment.class_section_id=version.class_section_id AND enrollment.term_id=version.term_id
        JOIN students student ON student.id=enrollment.student_id AND student.school_id=version.school_id
        WHERE version.id=${versionId}::uuid AND version.school_id=${schoolId}::uuid AND enrollment.enrolled_on<=${date}::date
          AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${date}::date)
      )
      SELECT DISTINCT ON(person.id) person.id AS person_id,concat_ws(' ',person.first_name,NULLIF(person.last_name,'')) AS label,
        CASE WHEN person.id=version.lead_person_id THEN 'lead' ELSE 'participant' END AS participation_role,
        expected.source_kind,expected.source_ref,expected.source_revision,person.revision AS person_revision,'required'::text AS requirement,
        bool_or(expected.attendance_expected) OVER(PARTITION BY person.id) AS attendance_expected
      FROM expected JOIN school_people person ON person.id=expected.person_id AND person.school_id=${schoolId}::uuid
      JOIN schedule_versions version ON version.id=${versionId}::uuid
      WHERE person.retired_at IS NULL OR person.retired_at>(${date}::date::timestamp AT TIME ZONE version.activity_timezone)
      ORDER BY person.id,expected.attendance_expected DESC,expected.source_kind,expected.source_ref
    `.execute(db)).rows;
    const teams = (await sql<{ group_id: string }>`SELECT group_id FROM schedule_plan_groups
      WHERE version_id=${versionId}::uuid AND school_id=${schoolId}::uuid AND group_kind='team'`.execute(db)).rows;
    for (const team of teams) {
      const members = await this.responsibilities.listPlanningTeamPeople(db as Transaction<Database>, { school_id: schoolId, team_id: team.group_id, at });
      const labels = (await sql<{ id: string; label: string }>`SELECT id,concat_ws(' ',first_name,NULLIF(last_name,'')) AS label FROM school_people
        WHERE school_id=${schoolId}::uuid AND id=ANY(${members.map(member => member.person_id)}::uuid[]) AND retired_at IS NULL`.execute(db)).rows;
      for (const member of members) {
        const label = labels.find(person => person.id === member.person_id)?.label;
        const existing = people.find(person => person.person_id === member.person_id);
        if (existing) existing.attendance_expected = true;
        else if (label) people.push({ person_id: member.person_id, label,
          participation_role: 'participant', source_kind: 'team', source_ref: member.source_ref, source_revision: member.source_revision,
          requirement: 'required', attendance_expected: true });
      }
    }
    return people;
  }

  async academicPeople(db: PlanningDb, schoolId: string, classId: string, termId: string, date: string, teacherUserId: string | null, at: string): Promise<ActivityParticipant[]> {
    const people = (await sql<ActivityParticipant>`
      WITH expected AS (
        SELECT student.person_id,'class'::text AS source_kind,enrollment.id::text AS source_ref,enrollment.revision AS source_revision,'participant'::text AS participation_role
        FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id AND student.school_id=${schoolId}::uuid
        WHERE enrollment.class_section_id=${classId}::uuid AND enrollment.term_id=${termId}::uuid
          AND enrollment.enrolled_on<=${date}::date AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${date}::date)
      )
      SELECT DISTINCT ON(person.id) person.id AS person_id,concat_ws(' ',person.first_name,NULLIF(person.last_name,'')) AS label,
        expected.participation_role,expected.source_kind,expected.source_ref,expected.source_revision,person.revision AS person_revision,
        'required'::text AS requirement,true AS attendance_expected
      FROM expected JOIN school_people person ON person.id=expected.person_id AND person.school_id=${schoolId}::uuid
      ORDER BY person.id,expected.participation_role
    `.execute(db)).rows;
    if (teacherUserId) {
      const teacher = await this.identities.resolveAccountEndpoint(db as Transaction<Database>, { school_id: schoolId, user_id: teacherUserId, at });
      if (teacher.person_id && !people.some(person => person.person_id === teacher.person_id)) {
        const person = (await sql<{ id: string; label: string; revision: number }>`SELECT id,concat_ws(' ',first_name,NULLIF(last_name,'')) AS label,revision
          FROM school_people WHERE school_id=${schoolId}::uuid AND id=${teacher.person_id}::uuid`.execute(db)).rows[0];
        if (person) people.push({ person_id: person.id, label: person.label, participation_role: 'lead', source_kind: 'teaching', source_ref: teacherUserId,
          source_revision: person.revision, person_revision: person.revision, requirement: 'required', attendance_expected: false });
      }
    }
    return people;
  }

  async retain(db: PlanningDb, occurrences: ActivityOccurrence[]) {
    for (const occurrence of occurrences) {
      const { participants, recorder_person_id, reviewer_person_id, ...row } = occurrence;
      const inserted = (await sql<{ id: string }>`INSERT INTO schedule_activity_occurrences(
        id,school_id,activity_id,plan_version_id,period_id,source,source_ref,source_revision,title,purpose,local_date,
        starts_at,ends_at,timezone,space_id,attendance_mode,context_kind,context_ref,term_id,subject_id,scheduled_teacher_id,period_number,state,revision,location_kind,location_label,location_url)
        VALUES(${row.id}::uuid,${row.school_id}::uuid,${row.activity_id}::uuid,${row.plan_version_id}::uuid,${row.period_id}::uuid,
          ${row.source},${row.source_ref},${row.source_revision},${row.title},${row.purpose},${row.local_date}::date,
          ${row.starts_at}::timestamptz,${row.ends_at}::timestamptz,${row.timezone},${row.space_id}::uuid,${row.attendance_mode},
          ${row.context_kind},${row.context_ref}::uuid,${row.term_id}::uuid,${row.subject_id}::uuid,${row.scheduled_teacher_id}::uuid,
          ${row.period_number},${row.state},${row.revision},${row.location_kind},${row.location_label},${row.location_url}) ON CONFLICT(id) DO NOTHING RETURNING id`.execute(db)).rows[0];
      // Roster is the source-revision snapshot. Never append later enrolments or
      // group members to an already captured occurrence/register silently.
      if (!inserted) continue;
      if(participants.length)await sql`INSERT INTO schedule_activity_occurrence_people(
        occurrence_id,school_id,person_id,label,participation_role,source_kind,source_ref,source_revision,person_revision,requirement,attendance_expected)
        SELECT ${row.id}::uuid,${row.school_id}::uuid,person_id,label,participation_role,source_kind,source_ref,source_revision,
          COALESCE(person_revision,source_revision),requirement,COALESCE(attendance_expected,true)
        FROM jsonb_to_recordset(${JSON.stringify(participants)}::jsonb) AS person(person_id uuid,label text,participation_role text,
          source_kind text,source_ref text,source_revision integer,person_revision integer,requirement text,attendance_expected boolean)
        ON CONFLICT DO NOTHING`.execute(db);
      for (const [action, personId] of [['record', recorder_person_id], ['review', reviewer_person_id]] as const) {
        if (!personId || !row.plan_version_id) continue;
        await sql`INSERT INTO schedule_activity_occurrence_recorders(occurrence_id,school_id,person_id,action,source_ref,source_revision,appointed_by)
          SELECT ${row.id}::uuid,${row.school_id}::uuid,${personId}::uuid,${action},version.id::text,version.revision,version.created_by
          FROM schedule_versions version WHERE version.id=${row.plan_version_id}::uuid
          ON CONFLICT DO NOTHING`.execute(db);
      }
    }
  }
}
