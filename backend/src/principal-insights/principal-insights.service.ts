import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { engagementSignals, percentage, shiftDate, type AttendanceStudent } from "./insight-rules.js";
import { principalReviewInput } from '../analytics/agent-report-contracts.js';

const input = z.object({date:z.iso.date().optional(),days:z.coerce.number().refine(v=>[14,28,56].includes(v)).default(28),class_section_id:z.uuid().optional(),threshold:z.coerce.number().int().min(1).max(99).default(50)});
type Daily={date:string;expected:number;recorded:number;scored:number;points:number};
type ClassRow={id:string;name:string;expected:number;recorded:number;scored:number;points:number};
type FollowupRow={id:string;student_name:string;class_id:string;attendance_date:string;state:string;owner:string;overdue:boolean};
type LearningRow={id:string;title:string;class_name:string;subject:string;assessed:number;below:number;roster:number;published_at:string};
type ScheduleRow={date:string;planned:number;unassigned:number;cancelled:number};
type DeadlineRow={date:string;class_id:string;class_name:string;homework:number;assessments:number;total:number};

@Injectable()
export class PrincipalInsightsService {
  constructor(private readonly db:DatabaseService) {}
  async review(user:AuthUser,schoolId:string,query:unknown) {
    const {topic,...options}=principalReviewInput.parse(query);
    const report=await this.overview(user,schoolId,options);
    const topics={
      attendance:{attendance:report.attendance,engagement:report.engagement,definitions:'A decline is at least 10 percentage points with at least 5 scored days and 80% completeness in both windows. Missing records are not absence. Lists are capped at 50; totals are uncapped. Missing homework completion records do not prove non-submission.'},
      learning:{learning:report.learning,threshold:report.threshold,definitions:'Latest published snapshots published in this review window. Scores below the selected percentage are review indicators, not diagnoses or official pass/fail grades.'},
      followups:{followups:report.followups,definitions:'Current open/overdue work and resolutions in the review period. Counts are records, not unique students. Detail is capped at 50.'},
      coverage:{schedule:report.schedule,deadlines:report.deadlines,definitions:'Next seven days from the operational date, not the historical review window. Assigned periods do not establish delivered lessons. Deadline pressure is at least 3 due items per class-day.'},
      fees:{fees:report.fees,currency:'INR',unit:'paise',definitions:'Outstanding invoices due by the operational date, net of credits, allocated payments and refunds. Aggregate ageing only; not individual balances. Due today is not overdue.'},
    };
    return {topic,generated_at:report.generated_at,period:report.period,operational_date:report.operational_date,class_section_id:report.class_section_id,...topics[topic]};
  }
  async overview(user:AuthUser,schoolId:string,query:unknown) {
    const parsed=input.safeParse(query);
    if(!z.uuid().safeParse(schoolId).success||!parsed.success) throw new BadRequestException("Use a valid school, ISO date, 14/28/56-day window and a review threshold from 1 to 99.");
    const options=parsed.data;
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db=>{
      const member=await db.selectFrom("school_memberships as membership").innerJoin("users as account","account.id","membership.user_id")
        .innerJoin("schools as school","school.id","membership.school_id").select(["school.timezone","school.name"])
        .where("membership.school_id","=",schoolId).where("membership.user_id","=",user.id).where("membership.role","=","admin")
        .where("membership.is_active","=",true).where("account.is_active","=",true).executeTakeFirst();
      if(!member||(user.active_school_id&&user.active_school_id!==schoolId)) throw new ForbiddenException("Select an institution where you are an active administrator to view principal insights.");
      const today=new Intl.DateTimeFormat("en-CA",{timeZone:member.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      const end=options.date&&options.date<today?options.date:today;
      const start=shiftDate(end,1-options.days),baselineStart=shiftDate(start,-options.days),classId=options.class_section_id??null;
      const classes=await db.selectFrom("class_sections").select(["id","grade","section","academic_year"]).where("school_id","=",schoolId).orderBy("grade").orderBy("section").execute();
      if(classId&&!classes.some(c=>c.id===classId)) throw new ForbiddenException("That class does not belong to the selected institution.");
      const attendance=(await sql<{daily:Daily[];classes:ClassRow[];students:AttendanceStudent[]}>`
        WITH cohort AS MATERIALIZED (
          SELECT DISTINCT s.id,p.first_name||' '||p.last_name AS name,e.class_section_id AS class_id,
            'Class '||c.grade||c.section AS class_name,e.term_id,e.enrolled_on,t.starts_on,t.ends_on
          FROM students s JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id
          JOIN enrollments e ON e.student_id=s.id AND e.is_active
          JOIN class_sections c ON c.id=e.class_section_id AND c.school_id=s.school_id
          JOIN academic_terms t ON t.id=e.term_id AND t.school_id=s.school_id
          WHERE s.school_id=${schoolId}::uuid AND ${end}::date BETWEEN t.starts_on AND t.ends_on
            AND e.enrolled_on<=${end}::date AND (${classId}::uuid IS NULL OR c.id=${classId}::uuid)
        ), days AS MATERIALIZED (
          SELECT DISTINCT d::date AS date,sch.class_section_id,sch.term_id
          FROM generate_series(${baselineStart}::date,${end}::date,'1 day') d
          CROSS JOIN LATERAL effective_school_schedule(${schoolId}::uuid,d::date) sch
          WHERE sch.slot_type IN ('class','activity') AND NOT sch.cancelled AND (${classId}::uuid IS NULL OR sch.class_section_id=${classId}::uuid)
        ), observations AS MATERIALIZED (
          SELECT c.id,c.name,c.class_id,c.class_name,d.date,ar.id AS record_id,ar.status,
            CASE WHEN ar.status IN ('present','late') THEN 1.0 WHEN ar.status='half_day' THEN 0.5 ELSE 0 END AS points
          FROM cohort c JOIN days d ON d.class_section_id=c.class_id AND d.term_id=c.term_id
            AND d.date BETWEEN GREATEST(c.enrolled_on,c.starts_on) AND c.ends_on
          LEFT JOIN attendance_records ar ON ar.student_id=c.id AND ar.class_section_id=c.class_id AND ar.date=d.date
        ), homework AS (
          SELECT c.id,c.class_id,count(*) FILTER(WHERE completion.item_id IS NULL)::int AS missing
          FROM cohort c JOIN diary_items item ON item.school_id=${schoolId}::uuid AND item.class_section_id=c.class_id
            AND item.term_id=c.term_id AND item.item_type='homework' AND item.date>=c.enrolled_on
            AND (item.due_at AT TIME ZONE ${member.timezone})::date BETWEEN ${start}::date AND ${end}::date AND item.due_at<=now() AND (item.published_at AT TIME ZONE ${member.timezone})::date<=${end}::date
          LEFT JOIN homework_completions completion ON completion.item_id=item.id AND completion.student_id=c.id
            AND (completion.completed_at AT TIME ZONE ${member.timezone})::date<=${end}::date
          GROUP BY c.id,c.class_id
        ), daily AS (
          SELECT date::text,count(*)::int AS expected,count(record_id)::int AS recorded,
            count(record_id) FILTER(WHERE status<>'excused')::int AS scored,sum(points)::float AS points
          FROM observations WHERE date>=${start}::date GROUP BY date ORDER BY date
        ), per_class AS (
          SELECT class_id AS id,class_name AS name,count(*)::int AS expected,count(record_id)::int AS recorded,
            count(record_id) FILTER(WHERE status<>'excused')::int AS scored,sum(points)::float AS points
          FROM observations WHERE date>=${start}::date GROUP BY class_id,class_name ORDER BY class_name
        ), per_student AS (
          SELECT o.id,o.name,o.class_id,o.class_name,
            count(*) FILTER(WHERE date>=${start}::date)::int AS expected,
            count(record_id) FILTER(WHERE date>=${start}::date)::int AS recorded,
            count(record_id) FILTER(WHERE date>=${start}::date AND status<>'excused')::int AS scored,
            COALESCE(sum(points) FILTER(WHERE date>=${start}::date),0)::float AS points,
            count(*) FILTER(WHERE date<${start}::date)::int AS previous_expected,
            count(record_id) FILTER(WHERE date<${start}::date)::int AS previous_recorded,
            count(record_id) FILTER(WHERE date<${start}::date AND status<>'excused')::int AS previous_scored,
            COALESCE(sum(points) FILTER(WHERE date<${start}::date),0)::float AS previous_points,
            COALESCE(h.missing,0)::int AS missing_homework,
            (SELECT count(*)::int FROM attendance_followups f WHERE f.school_id=${schoolId}::uuid AND f.student_id=o.id AND f.state<>'resolved') AS open_followups
          FROM observations o LEFT JOIN homework h ON h.id=o.id AND h.class_id=o.class_id
          GROUP BY o.id,o.name,o.class_id,o.class_name,h.missing
        ) SELECT COALESCE((SELECT json_agg(daily) FROM daily),'[]') AS daily,
          COALESCE((SELECT json_agg(per_class) FROM per_class),'[]') AS classes,
          COALESCE((SELECT json_agg(per_student) FROM per_student),'[]') AS students
      `.execute(db)).rows[0]!;
      const signals=engagementSignals(attendance.students);
      const distinctSignals=[...new Map(signals.map(s=>[s.id,s])).values()];
      const totals=attendance.daily.reduce((a,r)=>({expected:a.expected+r.expected,recorded:a.recorded+r.recorded,scored:a.scored+r.scored,points:a.points+r.points}),{expected:0,recorded:0,scored:0,points:0});
      const followups=(await sql<{awaiting:number;review:number;resolved:number;overdue:number;details:FollowupRow[]}>`
        WITH scoped AS MATERIALIZED (
          SELECT f.id,p.first_name||' '||p.last_name AS student_name,ar.class_section_id AS class_id,
            f.attendance_date::text,f.state,u.first_name||' '||u.last_name AS owner,(f.state<>'resolved' AND f.due_at<now()) AS overdue
          FROM attendance_followups f JOIN students s ON s.id=f.student_id AND s.school_id=f.school_id
          JOIN school_people p ON p.id=s.person_id AND p.school_id=f.school_id
          JOIN attendance_records ar ON ar.id=f.attendance_record_id JOIN users u ON u.id=f.owner_user_id
          WHERE f.school_id=${schoolId}::uuid AND (${classId}::uuid IS NULL OR ar.class_section_id=${classId}::uuid)
            AND (f.state<>'resolved' OR (f.resolved_at AT TIME ZONE ${member.timezone})::date BETWEEN ${start}::date AND ${end}::date)
        ) SELECT count(*) FILTER(WHERE state='awaiting_response')::int AS awaiting,
          count(*) FILTER(WHERE state='in_review')::int AS review,count(*) FILTER(WHERE state='resolved')::int AS resolved,
          count(*) FILTER(WHERE overdue)::int AS overdue,
          COALESCE((SELECT json_agg(detail) FROM (SELECT * FROM scoped WHERE state<>'resolved' ORDER BY overdue DESC,attendance_date,id LIMIT 50) detail),'[]') AS details FROM scoped
      `.execute(db)).rows[0]!;
      const learning=(await sql<LearningRow>`
        SELECT a.id,a.title,'Class '||c.grade||c.section AS class_name,s.name AS subject,
          count(r.student_id) FILTER(WHERE r.outcome='scored')::int AS assessed,
          count(r.student_id) FILTER(WHERE r.outcome='scored' AND r.marks*100/a.maximum_marks<${options.threshold})::int AS below,
          count(r.student_id)::int AS roster,publication.published_at::text
        FROM assessments a JOIN class_sections c ON c.id=a.class_section_id AND c.school_id=a.school_id
        JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
        JOIN LATERAL (SELECT p.id,p.published_at FROM assessment_publications p WHERE p.assessment_id=a.id AND p.school_id=a.school_id
          AND (p.published_at AT TIME ZONE ${member.timezone})::date<=${end}::date ORDER BY p.sequence DESC LIMIT 1) publication ON true
        JOIN assessment_publication_results r ON r.publication_id=publication.id AND r.school_id=a.school_id
        WHERE a.school_id=${schoolId}::uuid AND a.status<>'cancelled'
          AND (publication.published_at AT TIME ZONE ${member.timezone})::date>=${start}::date
          AND (${classId}::uuid IS NULL OR a.class_section_id=${classId}::uuid)
        GROUP BY a.id,c.grade,c.section,s.name,publication.published_at ORDER BY publication.published_at DESC,a.id
      `.execute(db)).rows;
      const schedule=(await sql<ScheduleRow>`
        SELECT d::date::text AS date,count(*) FILTER(WHERE NOT s.cancelled)::int AS planned,
          count(*) FILTER(WHERE NOT s.cancelled AND (s.teacher_user_id IS NULL OR s.coverage_status NOT IN ('not_required','accepted')))::int AS unassigned,count(*) FILTER(WHERE s.cancelled)::int AS cancelled
        FROM generate_series(${today}::date,${shiftDate(today,6)}::date,'1 day') d
        CROSS JOIN LATERAL effective_school_schedule(${schoolId}::uuid,d::date) s
        WHERE s.slot_type='class' AND (${classId}::uuid IS NULL OR s.class_section_id=${classId}::uuid) GROUP BY d ORDER BY d
      `.execute(db)).rows;
      const deadlines=(await sql<DeadlineRow>`
        WITH due AS (
          SELECT class_section_id,(due_at AT TIME ZONE ${member.timezone})::date AS date,1 AS homework,0 AS assessments
          FROM diary_items WHERE school_id=${schoolId}::uuid AND item_type='homework' AND published_at<=now()
          UNION ALL SELECT class_section_id,(scheduled_at AT TIME ZONE ${member.timezone})::date,0,1
          FROM assessments WHERE school_id=${schoolId}::uuid AND status='scheduled'
        ) SELECT due.date::text,c.id AS class_id,'Class '||c.grade||c.section AS class_name,
          sum(homework)::int AS homework,sum(assessments)::int AS assessments,count(*)::int AS total
        FROM due JOIN class_sections c ON c.id=due.class_section_id AND c.school_id=${schoolId}::uuid
        WHERE due.date BETWEEN ${today}::date AND ${shiftDate(today,6)}::date AND (${classId}::uuid IS NULL OR c.id=${classId}::uuid)
        GROUP BY due.date,c.id HAVING count(*)>=3 ORDER BY count(*) DESC,due.date,c.grade,c.section
      `.execute(db)).rows;
      const fees=(await sql<{band:string;due_paise:string;paid_paise:string;balance_paise:string}>`
        WITH balances AS (
          SELECT invoice.due_on,GREATEST(invoice.amount_paise-COALESCE(credit.amount,0),0) AS due,
            GREATEST(COALESCE(payment.amount,0)-COALESCE(refund.amount,0),0) AS paid
          FROM fee_invoices invoice
          LEFT JOIN LATERAL (SELECT sum(amount_paise) AS amount FROM fee_invoice_credits WHERE school_id=invoice.school_id AND invoice_id=invoice.id) credit ON true
          LEFT JOIN LATERAL (SELECT sum(amount_paise) AS amount FROM fee_payments WHERE school_id=invoice.school_id AND invoice_id=invoice.id) payment ON true
          LEFT JOIN LATERAL (SELECT sum(amount_paise) AS amount FROM fee_refunds WHERE school_id=invoice.school_id AND invoice_id=invoice.id) refund ON true
          WHERE invoice.school_id=${schoolId}::uuid AND invoice.due_on<=${today}::date
            AND (${classId}::uuid IS NULL OR EXISTS(SELECT 1 FROM enrollments e JOIN class_sections c ON c.id=e.class_section_id
              WHERE e.student_id=invoice.student_id AND e.is_active AND c.school_id=invoice.school_id AND e.class_section_id=${classId}::uuid))
        ) SELECT CASE WHEN due_on=${today}::date THEN 'Due today' WHEN ${today}::date-due_on<=30 THEN '1–30 days'
          WHEN ${today}::date-due_on<=60 THEN '31–60 days' WHEN ${today}::date-due_on<=90 THEN '61–90 days' ELSE '91+ days' END AS band,
          sum(due)::text AS due_paise,sum(LEAST(paid,due))::text AS paid_paise,sum(GREATEST(due-paid,0))::text AS balance_paise
        FROM balances GROUP BY band
      `.execute(db)).rows.map(r=>({...r,due_paise:Number(r.due_paise),paid_paise:Number(r.paid_paise),balance_paise:Number(r.balance_paise)}));
      return {school_id:schoolId,school_name:member.name,generated_at:new Date().toISOString(),timezone:member.timezone,
        period:{start,end,baseline_start:baselineStart,baseline_end:shiftDate(start,-1),days:options.days},operational_date:today,class_section_id:classId,threshold:options.threshold,
        classes:classes.map(c=>({id:c.id,name:`Class ${c.grade}${c.section} · ${c.academic_year}`})),
        attendance:{...totals,percentage:percentage(totals.points,totals.scored),completeness:percentage(totals.recorded,totals.expected),
          daily:attendance.daily.map(d=>({...d,percentage:percentage(d.points,d.scored)})),
          classes:attendance.classes.map(c=>({...c,percentage:percentage(c.points,c.scored),completeness:percentage(c.recorded,c.expected)}))},
        engagement:{total:distinctSignals.length,combined:distinctSignals.filter(s=>s.combined).length,without_followup:distinctSignals.filter(s=>s.open_followups===0).length,students:distinctSignals.slice(0,50),without_followup_students:distinctSignals.filter(s=>s.open_followups===0).slice(0,50)},
        followups,learning,schedule,deadlines,fees};
    });
  }
}
