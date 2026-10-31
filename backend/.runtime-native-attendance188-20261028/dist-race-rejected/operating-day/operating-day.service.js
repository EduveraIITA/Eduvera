var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { HUMAN_AGENT_IDENTITY_PORT, } from "../campus-model-core/human-agent-identity.port.js";
import { TEMPORAL_CONTEXT_PORT, } from "../campus-model-core/temporal-context.port.js";
import { CAMPUS_MODEL_CORE_PORT, } from "../campus-model-core/campus-model-core.port.js";
import { EXECUTION_CLOCK_PORT, } from "../campus-model-core/execution-clock.port.js";
import { DatabaseService } from "../database/database.service.js";
import { OperatingDayRepository } from "./operating-day.repository.js";
function iso(value) {
    return value ? new Date(value).toISOString() : null;
}
function sessionState(occurrence, asOf) {
    const now = Date.parse(asOf);
    if (now < new Date(occurrence.starts_at).getTime())
        return "upcoming";
    if (now >= new Date(occurrence.ends_at).getTime())
        return "completed";
    return "in_progress";
}
function registerState(row, required) {
    if (!required)
        return "not_required";
    if (!row || (!row.marked_count && row.state === "draft"))
        return "not_started";
    if (row.state === "submitted" || row.state === "locked")
        return row.state;
    return "in_progress";
}
let OperatingDayService = class OperatingDayService {
    db;
    repository;
    clock;
    temporal;
    identities;
    campusModel;
    constructor(db, repository, clock, temporal, identities, campusModel) {
        this.db = db;
        this.repository = repository;
        this.clock = clock;
        this.temporal = temporal;
        this.identities = identities;
        this.campusModel = campusModel;
    }
    async project(user, schoolId, requestedDate) {
        if (requestedDate && !z.string().date().safeParse(requestedDate).success) {
            throw new BadRequestException("date must be a valid calendar date in YYYY-MM-DD format.");
        }
        const [membership, school] = await Promise.all([
            this.repository.membership(user.id, schoolId),
            this.repository.school(schoolId),
        ]);
        if (!membership)
            throw new ForbiddenException("An active administrator or staff membership is required.");
        if (!school)
            throw new NotFoundException("Institution not found.");
        const viewerRole = membership.role === "admin" ? "admin" : "staff";
        const reading = this.clock.read({ institution_id: school.id, time_zone: school.timezone });
        const date = requestedDate ?? reading.local_date;
        const identity = await this.db.transaction().execute((transaction) => this.identities.resolveAccountEndpoint(transaction, {
            school_id: school.id,
            user_id: user.id,
            at: reading.iso_instant,
        }));
        const agentId = identity.acting ? identity.agent_id : null;
        const occurrences = await this.temporal.listOperatingDay({
            school_id: school.id,
            date,
            recorded_as_of: reading.iso_instant,
            ...(viewerRole === "staff" && agentId ? { responsible_agent_id: agentId } : {}),
        });
        const classOccurrences = occurrences.filter((item) => item.slot_type === "class");
        const [registers, gate, contradictions] = await Promise.all([
            this.repository.attendance(school.id, date, school.attendance_academic_mode, classOccurrences),
            this.repository.gateTotals(school.id, date, school.timezone, reading.iso_instant),
            this.campusModel.operationalSignals(school.id, reading.iso_instant, 50),
        ]);
        const registerByScope = new Map(registers.map((row) => [row.scope_key, row]));
        const sessions = occurrences.map((occurrence) => {
            const attendanceScope = school.attendance_academic_mode === "scheduled_session"
                ? occurrence.id
                : occurrence.class_domain_id;
            const attendance = registerByScope.get(attendanceScope);
            const required = occurrence.slot_type === "class" && school.attendance_academic_mode !== "none";
            return {
                id: occurrence.id,
                occurrence_id: occurrence.occurrence_id,
                period_number: occurrence.period_number,
                class_section_id: occurrence.class_domain_id,
                class_label: occurrence.class_label,
                subject_label: occurrence.subject_label,
                space_label: occurrence.space_label,
                teacher: occurrence.responsible_agent_id && occurrence.responsible_agent_label
                    ? { agent_id: occurrence.responsible_agent_id, label: occurrence.responsible_agent_label }
                    : null,
                title: occurrence.title,
                slot_type: occurrence.slot_type,
                starts_at: new Date(occurrence.starts_at).toISOString(),
                ends_at: new Date(occurrence.ends_at).toISOString(),
                state: sessionState(occurrence, reading.iso_instant),
                attendance: {
                    register_id: attendance?.register_id ?? null,
                    state: registerState(attendance, required),
                    revision: attendance?.revision ?? null,
                    marked_count: attendance?.marked_count ?? 0,
                    expected_count: attendance?.expected_count ?? 0,
                    submitted_at: iso(attendance?.submitted_at ?? null),
                },
                source: {
                    domain: occurrence.source_domain,
                    record_id: occurrence.source_record_id,
                    revision: occurrence.source_revision,
                    change_kind: occurrence.change_kind,
                },
                target_path: required
                    ? `/${viewerRole === "admin" ? "principal" : "teacher"}/attendance?${school.attendance_academic_mode === "scheduled_session" && attendance?.register_id
                        ? `session_id=${encodeURIComponent(attendance.register_id)}`
                        : `class_section_id=${encodeURIComponent(occurrence.class_domain_id)}`}&date=${date}`
                    : null,
            };
        });
        const current = sessions.filter((item) => item.state === "in_progress");
        const future = sessions.filter((item) => item.state === "upcoming");
        const nextStart = future[0]?.starts_at;
        const next = nextStart ? future.filter((item) => item.starts_at === nextStart) : [];
        const classSessions = sessions.filter((item) => item.slot_type === "class");
        const expectedRegisters = school.attendance_academic_mode === "scheduled_session"
            ? classSessions.map((item) => item.attendance)
            : school.attendance_academic_mode === "daily_class"
                ? [...new Map(classSessions.map((item) => [item.class_section_id, item.attendance])).values()]
                : [];
        return {
            schema_version: 1,
            environment: {
                kind: reading.environment_kind,
                label: reading.environment_kind === "simulation" ? "Simulation" : "Live",
                namespace_id: reading.namespace_id,
            },
            institution: { id: school.id, name: school.name, timezone: school.timezone },
            viewer: { role: viewerRole, agent_id: agentId },
            date,
            as_of: reading.iso_instant,
            summary: {
                scheduled_sessions: sessions.length,
                completed_sessions: sessions.filter((item) => item.state === "completed").length,
                current_sessions: current.length,
                upcoming_sessions: future.length,
                registers_expected: expectedRegisters.length,
                registers_submitted: expectedRegisters.filter((item) => item.state === "submitted" || item.state === "locked").length,
                registers_in_progress: expectedRegisters.filter((item) => item.state === "in_progress").length,
                registers_not_started: expectedRegisters.filter((item) => item.state === "not_started").length,
                gate_entries: Number(gate.entries),
                gate_exits: Number(gate.exits),
            },
            now: current,
            next,
            sessions,
            contradictions: contradictions.map((signal) => ({
                id: signal.id,
                kind: signal.kind,
                student_id: signal.student_id,
                student_label: signal.person_label,
                explanation: signal.kind === "attendance_after_exit"
                    ? `${signal.person_label} has accepted ${signal.attendance_status ?? "attendance"} evidence after an exit at ${signal.gate_label}.`
                    : `${signal.person_label} has a later expected ${signal.activity_label} session after an exit at ${signal.gate_label}.`,
                gate_observed_at: new Date(signal.gate_observed_at).toISOString(),
                expected_from: new Date(signal.expected_from).toISOString(),
                expected_until: new Date(signal.expected_until).toISOString(),
                attendance_status: signal.attendance_status,
            })),
            freshness: { schedule: "current", attendance: "authoritative", gate: "accepted_points" },
        };
    }
};
OperatingDayService = __decorate([
    Injectable(),
    __param(2, Inject(EXECUTION_CLOCK_PORT)),
    __param(3, Inject(TEMPORAL_CONTEXT_PORT)),
    __param(4, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(5, Inject(CAMPUS_MODEL_CORE_PORT)),
    __metadata("design:paramtypes", [DatabaseService,
        OperatingDayRepository, Object, Object, Object, Object])
], OperatingDayService);
export { OperatingDayService };
//# sourceMappingURL=operating-day.service.js.map