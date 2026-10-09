import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { performance } from "node:perf_hooks";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { SchoolService } from "../school/school.service.js";
import { provider, MockProvider } from "./providers.js";
import { requireProFeatures } from '../auth/pro-features.js';

const querySchema = z.object({ student_id: z.string().uuid().optional(), question: z.string().trim().min(3).max(800), conversation_id: z.string().uuid().optional() });

function futureAbsences(question: string): number | null {
  if (!/if|miss|bunk|absence|absent|days/i.test(question)) return null;
  const match = question.match(/\b(\d+)\s+(?:more\s+)?(?:school\s+)?(?:days?|absences?|classes?)\b/i);
  const value = match?.[1] ? Number(match[1]) : 1;
  if (value > 10) throw new BadRequestException("Projection requests cannot exceed 10 future absences.");
  return value;
}

@Injectable()
export class AiService {
  constructor(private readonly db: DatabaseService, private readonly school: SchoolService) {}

  async query(user: AuthUser, input: unknown, request: FastifyRequest) {
    await requireProFeatures(this.db,user.id);
    const data = querySchema.parse(input);
    if ([...data.question].some((char) => /\p{Cc}/u.test(char) && char !== "\n" && char !== "\t")) throw new BadRequestException("Question contains unsupported control characters.");
    const student = await this.school.studentForUser(user, data.student_id);
    const enrollment = await this.school.enrollment(student.id);
    const summary = await this.school.attendanceSummary(student.id, enrollment);
    const subjects = await this.school.subjectAttendance(student.id, enrollment.term_id);
    const policy = await this.db.selectFrom("attendance_policies").selectAll().where("term_id", "=", enrollment.term_id).executeTakeFirst();
    const threshold = Number(policy?.minimum_percentage ?? enrollment.attendance_threshold);
    const missed = futureAbsences(data.question);
    const projection = missed === null ? null : {
      future_absences: missed,
      projected_percentage: summary.total ? Math.round((summary.present + summary.late + summary.half_day * 0.5) * 10_000 / (summary.total + missed)) / 100 : 0,
      threshold,
      assumption: "Each projected absence is treated as one additional marked school day; the official timetable may differ.",
    };
    const sources = [
      { id: `attendance-term:${enrollment.term_id}:${student.id}`, label: `Daily attendance · ${enrollment.term_name}`, url: "/student/attendance" },
      { id: `attendance-policy:${policy?.id ?? enrollment.term_id}`, label: policy?.name ?? "Term attendance requirement", url: "/student/attendance/policy" },
      ...subjects.map((item) => ({ id: `subject-attendance:${item.id}`, label: `${item.subject.name} attendance`, url: `/student/attendance/subjects/${item.subject.id}` })),
    ];
    const context = {
      attendance_summary: summary,
      subjects: subjects.map((item) => ({
        subject: { name: item.subject.name },
        classes_held: item.classes_held,
        classes_attended: item.classes_attended,
        classes_excused: item.classes_excused,
        percentage: item.percentage,
      })),
      policy: policy
        ? {
            name: policy.name,
            minimum_percentage: policy.minimum_percentage,
            medical_document_after_days: policy.medical_document_after_days,
            policy_text: policy.policy_text,
          }
        : { name: "Term attendance requirement", minimum_percentage: threshold },
      threshold,
      attendance_projection: projection,
      sources: sources.map(({ label }) => ({ label })),
    };

    let conversationId = data.conversation_id;
    if (conversationId) {
      const conversation = await this.db.selectFrom("ai_conversations").select("id").where("id", "=", conversationId).where("owner_id", "=", user.id).where("student_id", "=", student.id).where("status", "=", "active").executeTakeFirst();
      if (!conversation) throw new BadRequestException("Conversation was not found for this user and student.");
    } else {
      conversationId = (await this.db.insertInto("ai_conversations").values({ owner_id: user.id, student_id: student.id, title: data.question.slice(0, 80) }).returning("id").executeTakeFirstOrThrow()).id;
    }
    await this.db.insertInto("ai_messages").values({ conversation_id: conversationId, role: "user", content: data.question, citations: sql`${JSON.stringify([])}::jsonb`, provider: "client", model: "client", latency_ms: null }).execute();
    const started = performance.now();
    try {
      let result = await provider().answer(data.question, context);
      if (projection) {
        const normalized = result.text.toLowerCase();
        const contradicts = projection.projected_percentage >= threshold
          ? /(?:attendance|projection).{0,100}\bbelow\b/.test(normalized)
          : /(?:attendance|projection).{0,100}\b(?:above|safe zone)\b/.test(normalized);
        if (contradicts) result = { ...(await new MockProvider().answer(data.question, context)), provider: result.provider, model: result.model };
      }
      const latency = Math.round(performance.now() - started);
      const answer = sources.reduce(
        (text, source) => text.replaceAll(`[${source.id}]`, `[${source.label}]`),
        result.text,
      ).replace(/\[(?:policy_id|term_id|student_id):[^\]]+\]/gi, "").slice(0, 6000).trim();
      const message = await this.db.insertInto("ai_messages").values({ conversation_id: conversationId, role: "assistant", content: answer, citations: sql`${JSON.stringify(sources)}::jsonb`, provider: result.provider, model: result.model, latency_ms: latency }).returning("id").executeTakeFirstOrThrow();
      await this.db.updateTable("ai_conversations").set({ updated_at: new Date() }).where("id", "=", conversationId).execute();
      await sql`INSERT INTO audit_events(action, actor_id, school_id, target_type, target_id, request_id, ip_hash, metadata) VALUES ('ai.attendance.query', ${user.id}::uuid, ${student.school_id}::uuid, 'ai_conversation', ${conversationId}::uuid, ${(request as any).requestId}::uuid, encode(digest(${request.ip}, 'sha256'),'hex'), ${JSON.stringify({ provider: result.provider, model: result.model })}::jsonb)`.execute(this.db);
      return { conversation_id: conversationId, message_id: message.id, student_id: student.id, answer, citations: sources, sources, provider: result.provider, model: result.model, latency_ms: latency };
    } catch (error) {
      await this.db.insertInto("ai_messages").values({ conversation_id: conversationId, role: "assistant", content: "The attendance assistant could not complete this request.", citations: sql`${JSON.stringify([])}::jsonb`, provider: "error", model: "unavailable", status: "error", latency_ms: Math.round(performance.now() - started) }).execute();
      throw new ServiceUnavailableException("Attendance Copilot is temporarily unavailable.", { cause: error });
    }
  }
}
