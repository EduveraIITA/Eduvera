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
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { ActivityAttendanceService } from "../attendance/activity-attendance.service.js";
import { upcomingWorkspaceRecords } from "./upcoming-workspace.projection.js";
const shifted = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Application composition over published domain facts, never another editor or grant. */
let ActivityWorkspaceProjection = class ActivityWorkspaceProjection {
    db;
    planning;
    attendance;
    identities;
    constructor(db, planning, attendance, identities) {
        this.db = db;
        this.planning = planning;
        this.attendance = attendance;
        this.identities = identities;
    }
    async load(user, snapshot, at, date) {
        const schoolId = snapshot.institution.id;
        const actor = await this.db.transaction().execute((tx) => this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: at.toISOString() }));
        if (!actor.acting)
            return { assignments: [], now: [], next: [], work: [] };
        const reviews = await this.attendance.pendingActivityReviews(user, schoolId);
        const authority = (await sql `SELECT
      bool_or(member.role='admin' OR staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,
        'attendance.record','institution',${schoolId}::uuid,${date}::date)) AS record,
      bool_or(member.role='admin' OR staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,
        'attendance.review','institution',${schoolId}::uuid,${date}::date)) AS review,
      bool_or(staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,
        'learning.sessions.manage','institution',${schoolId}::uuid,${date}::date)) AS teach
      FROM school_memberships member JOIN users account ON account.id=member.user_id AND account.is_active
      WHERE member.school_id=${schoolId}::uuid AND member.user_id=${user.id}::uuid AND member.is_active`.execute(this.db)).rows[0];
        // Academic/event/exam Today facts already come from their owning temporal
        // projection. Do not expand and retain campus-wide rosters that this
        // activity contribution immediately discards, especially on a cold fork.
        const occurrences = await this.planning.ensureOccurrences(schoolId, shifted(date, -1), shifted(date, 7), undefined, { source: "activity" });
        const records = await this.db.transaction().execute(async (tx) => {
            const plans = (await sql `
        SELECT DISTINCT version.id,version.activity_title,version.revision,version.published_at,version.ends_on::text,
          version.recorder_person_id,version.reviewer_person_id FROM schedule_versions version
        WHERE version.school_id=${schoolId}::uuid AND version.planning_origin='activity' AND version.state='published'
          AND (version.ends_on IS NULL OR version.ends_on>=${date}::date)
          AND (version.recorder_person_id=${actor.person_id}::uuid OR version.reviewer_person_id=${actor.person_id}::uuid)
        ORDER BY version.id`.execute(tx)).rows;
            const assignments = [];
            for (const plan of plans)
                for (const action of [
                    ...(plan.recorder_person_id === actor.person_id && authority?.record ? ["attendance.record"] : []),
                    ...(plan.reviewer_person_id === actor.person_id && authority?.review ? ["attendance.review"] : []),
                    ...(plan.recorder_person_id === actor.person_id && authority?.record || plan.reviewer_person_id === actor.person_id && authority?.review ? ["timetable.view"] : []),
                ])
                    assignments.push({
                        id: `activity:${plan.id}:${action}`, owner_agent_id: actor.agent_id, capability_key: action, action_key: action,
                        scope: { kind: "other", id: plan.id, label: plan.activity_title }, effective_from: new Date(plan.published_at).toISOString(),
                        effective_until: null, effective_schedule: null, authority_source_kind: "published_activity_appointment",
                        authority_source_ref: plan.id, fallback_agent_id: null, source_domain: "timetable", source_record_id: plan.id,
                        source_revision: plan.revision, revision: plan.revision, projection_source: "canonical",
                    });
            return { plans, assignments };
        });
        // A plan may have ended long ago while its submitted attendance remains open.
        // Keep that exact source responsibility discoverable without treating all
        // administrators as reviewers or deriving ownership from a job title.
        for (const review of reviews)
            if (!records.assignments.some(item => item.action_key === "attendance.review"
                && item.authority_source_ref === review.plan_version_id)) {
                records.assignments.push({ id: `activity-review:${review.register_id}`, owner_agent_id: actor.agent_id,
                    capability_key: "attendance.review", action_key: "attendance.review",
                    scope: { kind: "other", id: review.occurrence_id, label: review.title },
                    effective_from: new Date(review.submitted_at).toISOString(), effective_until: null, effective_schedule: null,
                    authority_source_kind: "published_occurrence_appointment", authority_source_ref: review.plan_version_id,
                    fallback_agent_id: null, source_domain: "attendance", source_record_id: review.register_id,
                    source_revision: review.revision, revision: review.appointment_revision, projection_source: "canonical" });
            }
        const work = reviews.map(review => ({
            id: `activity-attendance-review:${review.register_id}`, kind: "task", urgency: "normal",
            title: `Review attendance · ${review.title}`, detail: review.finalization?.reason === "overdue"
                ? "Automatic finalization is overdue. Review the submitted register." : "Submitted for your review.",
            status_label: "Awaiting review", source_label: "Attendance",
            time_label: new Intl.DateTimeFormat("en", { timeZone: review.timezone, day: "numeric", month: "short", year: "numeric" }).format(new Date(review.starts_at)),
            href: `/areas/attendance/registers?${new URLSearchParams({ date: review.local_date, register_id: review.register_id }).toString()}`,
            action_label: "Review register", tone: "attention",
        }));
        const participantOccurrences = occurrences.filter((occurrence) => occurrence.source === "activity" && occurrence.state === "expected"
            && (snapshot.membership_roles.includes("admin") || occurrence.participants.some((person) => person.person_id === actor.person_id)
                || occurrence.recorder_person_id === actor.person_id && authority?.record || occurrence.reviewer_person_id === actor.person_id && authority?.review));
        if (participantOccurrences.length && !records.assignments.some((item) => item.action_key === "timetable.view")) {
            records.assignments.push({ id: `activity:participation:${actor.person_id}`, owner_agent_id: actor.agent_id,
                capability_key: "timetable.view", action_key: "timetable.view", scope: { kind: "self", id: actor.person_id, label: "My scheduled activities" },
                effective_from: at.toISOString(), effective_until: null, effective_schedule: null, authority_source_kind: "participation_expectation",
                authority_source_ref: actor.person_id, fallback_agent_id: null, source_domain: "timetable", source_record_id: actor.person_id,
                source_revision: 1, revision: 1, projection_source: "canonical" });
        }
        const now = [], next = [];
        for (const occurrence of participantOccurrences) {
            if (Date.parse(occurrence.ends_at) <= at.getTime())
                continue;
            const current = Date.parse(occurrence.starts_at) <= at.getTime();
            const canOpenRegister = occurrence.attendance_mode !== "none"
                && (occurrence.recorder_person_id === actor.person_id && authority?.record || occurrence.reviewer_person_id === actor.person_id && authority?.review);
            const registerId = canOpenRegister ? await this.attendance.ensureRegister(schoolId, occurrence.id) : null;
            const teachingScope = authority?.teach || occurrence.context_ref && snapshot.assignments.some(assignment => assignment.action_key === "learning.sessions.manage" && assignment.scope.kind === "class" && assignment.scope.id === occurrence.context_ref);
            const canTeach = occurrence.purpose === "teaching" && teachingScope
                && occurrence.participants.some(person => person.person_id === actor.person_id && person.participation_role === "lead");
            const time = new Intl.DateTimeFormat("en", { timeZone: occurrence.timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(occurrence.starts_at));
            const expectsAttendance = occurrence.attendance_mode !== "none";
            const peopleCount = expectsAttendance ? occurrence.participants.filter(person => person.attendance_expected !== false).length : occurrence.participants.length;
            const peopleLabel = expectsAttendance ? `${peopleCount} expected ${peopleCount === 1 ? "participant" : "participants"}`
                : `${peopleCount} scheduled ${peopleCount === 1 ? "person" : "people"}`;
            const record = {
                id: `activity-occurrence:${occurrence.id}`, title: occurrence.title,
                detail: `${occurrence.space_label ? `Scheduled at ${occurrence.space_label}` : "Scheduled activity"} · ${peopleLabel}`,
                status_label: current ? "Now" : "Next", time_label: time,
                starts_at: occurrence.starts_at, ends_at: occurrence.ends_at, local_date: occurrence.local_date,
                href: canTeach ? `/areas/timetable/session?${new URLSearchParams({ date: occurrence.local_date, occurrence_id: occurrence.id }).toString()}`
                    : registerId ? `/areas/attendance/registers?${new URLSearchParams({ date: occurrence.local_date, register_id: registerId }).toString()}`
                        : `/areas/timetable/schedule?${new URLSearchParams({ date: occurrence.local_date }).toString()}`,
                action_label: canTeach ? "Open session" : registerId ? "Open register" : "Open timetable", source_label: "Published activity plan", tone: current ? "info" : "neutral",
            };
            (current ? now : next).push(record);
        }
        return { assignments: records.assignments, now: now.slice(0, 5), next: upcomingWorkspaceRecords(next).slice(0, 5), work };
    }
};
ActivityWorkspaceProjection = __decorate([
    Injectable(),
    __param(3, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __metadata("design:paramtypes", [DatabaseService, ActivityPlanningService,
        ActivityAttendanceService, Object])
], ActivityWorkspaceProjection);
export { ActivityWorkspaceProjection };
//# sourceMappingURL=activity-workspace.projection.js.map