var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { SchoolService } from "../school/school.service.js";
import { provider, MockProvider } from "./providers.js";
import { requireProFeatures } from '../auth/pro-features.js';
const querySchema = z.object({ student_id: z.string().uuid().optional(), question: z.string().trim().min(3).max(800), conversation_id: z.string().uuid().optional() });
function futureAbsences(question) {
    if (!/if|miss|bunk|absence|absent|days/i.test(question))
        return null;
    const match = question.match(/\b(\d+)\s+(?:more\s+)?(?:school\s+)?(?:days?|absences?|classes?)\b/i);
    const value = match?.[1] ? Number(match[1]) : 1;
    if (value > 10)
        throw new BadRequestException("Projection requests cannot exceed 10 future absences.");
    return value;
}
let AiService = class AiService {
    db;
    school;
    constructor(db, school) {
        this.db = db;
        this.school = school;
    }
    async query(user, input, request) {
        await requireProFeatures(this.db, user.id);
        const data = querySchema.parse(input);
        if ([...data.question].some((char) => /\p{Cc}/u.test(char) && char !== "\n" && char !== "\t"))
            throw new BadRequestException("Question contains unsupported control characters.");
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
        const relationshipScope = student.user_id === user.id ? "self" : "dependent";
        const attendanceUrl = `/areas/attendance/records?scope=${relationshipScope}&student_id=${encodeURIComponent(student.id)}`;
        const sources = [
            { id: `attendance-term:${enrollment.term_id}:${student.id}`, label: `Daily attendance · ${enrollment.term_name}`, url: attendanceUrl },
            { id: `attendance-policy:${policy?.id ?? enrollment.term_id}`, label: policy?.name ?? "Term attendance requirement", url: `${attendanceUrl}&view=eligibility` },
            ...subjects.map((item) => ({ id: `subject-attendance:${item.id}`, label: `${item.subject.name} attendance`, url: `${attendanceUrl}&subject_id=${encodeURIComponent(item.subject.id)}` })),
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
            if (!conversation)
                throw new BadRequestException("Conversation was not found for this user and student.");
        }
        else {
            conversationId = (await this.db.insertInto("ai_conversations").values({ owner_id: user.id, student_id: student.id, title: data.question.slice(0, 80) }).returning("id").executeTakeFirstOrThrow()).id;
        }
        await this.db.insertInto("ai_messages").values({ conversation_id: conversationId, role: "user", content: data.question, citations: sql `${JSON.stringify([])}::jsonb`, provider: "client", model: "client", latency_ms: null }).execute();
        const started = performance.now();
        try {
            let result = await provider().answer(data.question, context);
            if (projection) {
                const normalized = result.text.toLowerCase();
                const contradicts = projection.projected_percentage >= threshold
                    ? /(?:attendance|projection).{0,100}\bbelow\b/.test(normalized)
                    : /(?:attendance|projection).{0,100}\b(?:above|safe zone)\b/.test(normalized);
                if (contradicts)
                    result = { ...(await new MockProvider().answer(data.question, context)), provider: result.provider, model: result.model };
            }
            const latency = Math.round(performance.now() - started);
            const answer = sources.reduce((text, source) => text.replaceAll(`[${source.id}]`, `[${source.label}]`), result.text).replace(/\[(?:policy_id|term_id|student_id):[^\]]+\]/gi, "").slice(0, 6000).trim();
            const message = await this.db.insertInto("ai_messages").values({ conversation_id: conversationId, role: "assistant", content: answer, citations: sql `${JSON.stringify(sources)}::jsonb`, provider: result.provider, model: result.model, latency_ms: latency }).returning("id").executeTakeFirstOrThrow();
            await this.db.updateTable("ai_conversations").set({ updated_at: new Date() }).where("id", "=", conversationId).execute();
            await sql `INSERT INTO audit_events(action, actor_id, school_id, target_type, target_id, request_id, ip_hash, metadata) VALUES ('ai.attendance.query', ${user.id}::uuid, ${student.school_id}::uuid, 'ai_conversation', ${conversationId}::uuid, ${request.requestId}::uuid, encode(digest(${request.ip}, 'sha256'),'hex'), ${JSON.stringify({ provider: result.provider, model: result.model })}::jsonb)`.execute(this.db);
            return { conversation_id: conversationId, message_id: message.id, student_id: student.id, answer, citations: sources, sources, provider: result.provider, model: result.model, latency_ms: latency };
        }
        catch (error) {
            await this.db.insertInto("ai_messages").values({ conversation_id: conversationId, role: "assistant", content: "The attendance assistant could not complete this request.", citations: sql `${JSON.stringify([])}::jsonb`, provider: "error", model: "unavailable", status: "error", latency_ms: Math.round(performance.now() - started) }).execute();
            throw new ServiceUnavailableException("Attendance Copilot is temporarily unavailable.", { cause: error });
        }
    }
};
AiService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, SchoolService])
], AiService);
export { AiService };
//# sourceMappingURL=ai.service.js.map