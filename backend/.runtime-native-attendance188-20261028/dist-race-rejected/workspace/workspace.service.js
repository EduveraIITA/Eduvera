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
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { EXECUTION_CLOCK_PORT } from "../campus-model-core/execution-clock.port.js";
import { TEMPORAL_CONTEXT_PORT, } from "../campus-model-core/temporal-context.port.js";
import { RequestsService } from "../requests/requests.service.js";
import { allWorkspaceAreaDefinitions, relationshipAreaKeys, uniqueWorkspaceScopes, workspaceAreaForCapability, } from "./workspace-area.catalogue.js";
import { effectiveScheduleSchema, } from "./workspace.contracts.js";
import { WorkspaceRepository } from "./workspace.repository.js";
import { ActivityWorkspaceProjection } from "./activity-workspace.projection.js";
import { StaffLeaveWorkProjection } from "../staff-operations/staff-leave-work.projection.js";
import { LearningAssignmentsService } from "../learning/learning-assignments.service.js";
import { FinanceArrangementsReadService } from "../operations/finance-arrangements.read.js";
import { NativeFeeReviewsService } from "../operations/native-fee-reviews.service.js";
import { accommodationWork, assignmentWork, diningWork, facilitiesWork, financeArrangementWork, hasNativeWorkflowProjection, nativeFeeReviewWork, resourceLoanWork, visitQuestionWork } from "./workflow-work.projection.js";
import { ResourceLoansService } from "../resource-loans/resource-loans.service.js";
import { FacilitiesService } from "../facilities/facilities.service.js";
import { AccommodationService } from "../facilities/accommodation/accommodation.service.js";
import { DiningService } from "../dining/dining.service.js";
import { diningTodayRecords } from "./dining-workspace.projection.js";
import { upcomingWorkspaceRecords } from "./upcoming-workspace.projection.js";
import { FeeAuthorityService } from "../governance/fee-authority.service.js";
import { WorkspaceProjectionReads } from "./workspace-projection-reads.js";
import { VisitSharingService } from "../gate/visit-sharing.service.js";
import { RestrictedCareService } from "../restricted-care/restricted-care.service.js";
function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function text(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function integer(value) {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}
function query(path, values) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
        if (value !== null)
            parameters.set(key, String(value));
    const suffix = parameters.toString();
    return suffix ? `${path}?${suffix}` : path;
}
export function workHref(message) {
    const payload = object(message.payload);
    const kind = message.reaction_kind;
    if (kind === "staff_leave_decision_review") {
        const request = text(payload.request_id);
        return request ? query("/work/staff-leave", { request }) : query("/work", { item: message.id, unavailable: "source" });
    }
    if (kind.includes("coverage") && kind.includes("offer")) {
        const coverage = text(payload.coverage_task_id);
        const revision = integer(payload.source_revision);
        return coverage
            ? query("/areas/responsibilities/coverage", { coverage, coverage_revision: revision })
            : query("/work", { item: message.id, unavailable: "source" });
    }
    if (kind === "attendance_completion_task") {
        const date = text(payload.date);
        const session = text(payload.session_id);
        const classSection = text(payload.class_section_id);
        return date && (session || classSection)
            ? query("/areas/attendance/registers", { date, session_id: session, class_section_id: session ? null : classSection })
            : query("/work", { item: message.id, unavailable: "source" });
    }
    if (kind === "assessment_invigilation_offer") {
        const assessment = text(payload.assessment_id);
        return assessment
            ? query("/areas/assessments/assigned", { assessment, focus: "invigilation" })
            : query("/work", { item: message.id, unavailable: "source" });
    }
    if (kind === "transport_duty_offer" || kind === "transport_duty_decision_review") {
        const trip = text(payload.requester_trip_id) ?? text(payload.trip_id);
        const swap = text(payload.duty_change_id);
        const revision = integer(payload.source_revision);
        return trip
            ? query(`/areas/departure/operate/${encodeURIComponent(trip)}`, { swap, swap_revision: revision })
            : query("/work", { item: message.id, unavailable: "source" });
    }
    return query("/work", { item: message.id, unavailable: "route" });
}
function relativeDue(target, at) {
    const milliseconds = new Date(target).getTime() - at.getTime();
    const minutes = Math.max(1, Math.round(Math.abs(milliseconds) / 60_000));
    if (milliseconds < 0)
        return `${minutes} min overdue`;
    if (minutes < 60)
        return `Due in ${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `Due in ${hours} hr`;
}
function work(message, at, timeZone) {
    const deadline = message.response_due_at ?? message.expires_at;
    const remaining = deadline ? new Date(deadline).getTime() - at.getTime() : Number.POSITIVE_INFINITY;
    const urgency = deadline && remaining <= 0
        ? (message.expires_at && new Date(message.expires_at).getTime() <= at.getTime() ? "critical" : "overdue")
        : remaining <= 2 * 60 * 60 * 1000 ? "due_soon" : "normal";
    const href = workHref(message);
    const routeUnavailable = href.includes("unavailable=");
    return {
        id: message.id,
        kind: message.message_kind,
        urgency,
        title: message.subject,
        detail: routeUnavailable
            ? `${message.summary} Its domain record link is unavailable; review it from Work.`
            : message.summary,
        status_label: routeUnavailable ? "Source unavailable" : message.state === "acknowledged" ? "Seen · response needed" : "Response needed",
        ...(deadline ? { due_label: relativeDue(deadline, at), time_label: relativeDue(deadline, at) } : {}),
        href,
        action_label: routeUnavailable ? "Review in Work" : message.message_kind === "offer" ? "Review offer" : message.message_kind === "request" ? "Review request" : "Open task",
        source_label: message.source_domain.replaceAll("_", " "),
        due_at: deadline,
        created_at: message.queued_at,
        ...(message.reaction_kind === "staff_leave_decision_review" && text(object(message.payload).request_id) ? {
            source: { domain: "staff_operations", kind: "staff_leave_request", id: text(object(message.payload).request_id), action: "decide", revision: integer(object(message.payload).source_revision) },
            core_trace: { message_ids: [message.id] },
        } : {}),
        source_at: new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(message.queued_at)),
        tone: urgency === "critical" || urgency === "overdue" ? "critical" : routeUnavailable || urgency === "due_soon" ? "attention" : "neutral",
    };
}
const offerKinds = new Set([
    "responsibility_offer",
    "coverage_offer",
    "transport_assignment",
    "assessment_invigilation",
]);
const requestKinds = new Set([
    "attendance_followup",
    "departure_change",
    "event_consent",
    "event_rsvp",
    "leave_signature",
    "notice_response",
    "policy_acknowledgement",
    "staff_leave_review",
    "student_leave_review",
    "teacher_feedback",
    "transport_swap",
    "transport_swap_approval",
]);
function requestWork(item, at, timeZone) {
    // A leave start date is not a reviewer SLA. The Core message, when present,
    // retains the configured response deadline and wins the same-source merge.
    const deadline = item.kind === "staff_leave_review" ? null : item.due_at;
    const remaining = deadline ? Date.parse(deadline) - at.getTime() : Number.POSITIVE_INFINITY;
    const urgency = item.priority === "urgent" && remaining <= 0
        ? "overdue"
        : item.priority === "urgent"
            ? "critical"
            : item.priority === "high" || remaining <= 2 * 60 * 60 * 1000
                ? "due_soon"
                : "normal";
    const kind = offerKinds.has(item.kind) ? "offer" : requestKinds.has(item.kind) ? "request" : "task";
    const sourceAt = item.occurs_at ?? item.created_at;
    return {
        id: `domain:${item.id}`,
        kind,
        urgency,
        title: item.title,
        detail: item.detail,
        status_label: item.status_label,
        ...(deadline ? { due_label: relativeDue(deadline, at), time_label: relativeDue(deadline, at) } : {}),
        href: item.href,
        action_label: item.action_label,
        source_label: item.category.replaceAll("_", " "),
        due_at: deadline,
        created_at: item.created_at,
        occurs_at: item.occurs_at,
        ...(item.kind === "staff_leave_review" ? {
            source: { domain: "staff_operations", kind: "staff_leave_request", id: item.source_id, action: "decide", revision: null },
        } : {}),
        ...(sourceAt && !Number.isNaN(Date.parse(sourceAt)) ? {
            source_at: new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(sourceAt)),
        } : {}),
        tone: urgency === "critical" || urgency === "overdue" ? "critical" : urgency === "due_soon" ? "attention" : "neutral",
    };
}
export function mergeWorkItems(messages, domain, namespace = "current") {
    const seen = new Set();
    const result = [];
    // Typed Model Core messages win an exact collision because they retain the
    // coordination trace. Domain queues fill the still-unmigrated capability
    // gaps without replacing those protocol records.
    for (const item of [...messages, ...domain]) {
        const key = item.source ? JSON.stringify([namespace, item.source.domain, item.source.kind, item.source.id, item.source.action]) : `item:${item.id}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(item);
    }
    const rank = { critical: 0, overdue: 1, due_soon: 2, normal: 3 };
    return result.sort((left, right) => rank[left.urgency] - rank[right.urgency]
        || left.title.localeCompare(right.title));
}
function waitingWork(item, timeZone) {
    const status = item.state === "needs_reassignment" ? "Review route changed — needs reassignment"
        : item.state === "route_unavailable" ? "Review route unavailable" : `Waiting for ${item.reviewer?.label ?? "review"}`;
    return { id: `staff-leave-waiting:${item.id}`, kind: "request", direction: "waiting", state: item.state, urgency: "normal",
        title: item.policy_label, detail: `${item.starts_on}${item.ends_on !== item.starts_on ? ` – ${item.ends_on}` : ""} · Leave requested`,
        status_label: status, href: query("/areas/responsibilities/leave", { request: item.id, request_revision: item.revision }), action_label: "View request",
        source_label: "Staff leave", source: { domain: "staff_operations", kind: "staff_leave_request", id: item.id, action: "await_decision", revision: item.revision },
        ...(item.reviewer ? { owner: item.reviewer } : {}), ...(item.message_id ? { core_trace: { message_ids: [item.message_id] } } : {}),
        due_at: item.response_due_at, created_at: item.created_at, occurs_at: `${item.starts_on}T12:00:00.000Z`,
        ...(item.response_due_at ? { due_label: `Response due ${new Intl.DateTimeFormat("en", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(item.response_due_at))}` } : {}),
        tone: item.state === "waiting_for_review" ? "neutral" : "attention" };
}
function scheduleLocalParts(at, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(at);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return { weekday: weekdays[values.weekday ?? ""] ?? 1, time: `${values.hour}:${values.minute}` };
}
function currentWindow(schedule, at) {
    const local = scheduleLocalParts(at, schedule.time_zone);
    return schedule.weekly_windows.find((window) => window.days.includes(local.weekday)
        && window.starts_at <= local.time && window.ends_at > local.time) ?? null;
}
function nextWindow(schedule, at) {
    const local = scheduleLocalParts(at, schedule.time_zone);
    let best = null;
    for (const window of schedule.weekly_windows) {
        for (const day of window.days) {
            let distance = (day - local.weekday + 7) % 7;
            if (distance === 0 && window.starts_at <= local.time)
                distance = 7;
            if (!best || distance < best.distance || (distance === best.distance && window.starts_at < best.starts_at)) {
                best = { distance, day, starts_at: window.starts_at, ends_at: window.ends_at };
            }
        }
    }
    return best;
}
function dutyRecord(assignment, status, timeLabel) {
    const area = workspaceAreaForCapability(assignment.action_key) ?? workspaceAreaForCapability(assignment.capability_key);
    if (!area)
        return null;
    return {
        id: `responsibility:${assignment.id}:${status.toLowerCase()}`,
        title: assignment.scope.label ?? area.label,
        detail: `${area.label} · ${assignment.action_key.replaceAll(".", " ")}`,
        status_label: status,
        time_label: timeLabel,
        href: area.href,
        action_label: `Open ${area.label}`,
        source_label: "Effective responsibility",
        tone: status === "Now" ? "info" : "neutral",
    };
}
function scheduledResponsibilities(assignments, at) {
    const now = [];
    const next = [];
    for (const assignment of assignments) {
        const parsed = effectiveScheduleSchema.safeParse(assignment.effective_schedule);
        if (!parsed.success)
            continue;
        const current = currentWindow(parsed.data, at);
        if (current) {
            const item = dutyRecord(assignment, "Now", `${current.starts_at}–${current.ends_at}`);
            if (item)
                now.push(item);
            continue;
        }
        const upcoming = nextWindow(parsed.data, at);
        if (upcoming) {
            const day = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][upcoming.day];
            const item = dutyRecord(assignment, "Next", `${day} · ${upcoming.starts_at}`);
            if (item)
                next.push(item);
        }
    }
    return { now: now.slice(0, 5), next: next.slice(0, 5) };
}
function occurrenceTime(value, timeZone) {
    return new Intl.DateTimeFormat("en", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(value));
}
function assignmentCoversClass(assignment, schoolId, classSectionId) {
    return (assignment.scope.kind === "institution" && assignment.scope.id === schoolId)
        || (assignment.scope.kind === "class" && assignment.scope.id === classSectionId);
}
function operatingDayRecords(snapshot, occurrences, at, localDate) {
    const representedAssignments = new Set();
    const candidates = [];
    for (const occurrence of occurrences) {
        const starts = new Date(occurrence.starts_at).getTime();
        const ends = new Date(occurrence.ends_at).getTime();
        if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts)
            continue;
        const timeLabel = `${occurrenceTime(occurrence.starts_at, snapshot.institution.timezone)}–${occurrenceTime(occurrence.ends_at, snapshot.institution.timezone)}`;
        const owned = Boolean(snapshot.acting_agent_id
            && occurrence.responsible_agent_id === snapshot.acting_agent_id);
        if (owned) {
            const recordAssignment = snapshot.assignments.find((assignment) => assignment.action_key === "attendance.record"
                && assignmentCoversClass(assignment, snapshot.institution.id, occurrence.class_domain_id));
            const teachingAssignment = snapshot.assignments.find((assignment) => assignment.action_key === "learning.sessions.manage"
                && assignmentCoversClass(assignment, snapshot.institution.id, occurrence.class_domain_id));
            for (const assignment of snapshot.assignments) {
                const area = workspaceAreaForCapability(assignment.action_key) ?? workspaceAreaForCapability(assignment.capability_key);
                if ((area?.key === "attendance" || area?.key === "timetable")
                    && assignmentCoversClass(assignment, snapshot.institution.id, occurrence.class_domain_id)) {
                    representedAssignments.add(assignment.id);
                }
            }
            candidates.push({
                starts,
                ends,
                record: {
                    id: `schedule:owned:${occurrence.occurrence_id}`,
                    title: occurrence.subject_label
                        ? `${occurrence.subject_label} · ${occurrence.class_label}`
                        : occurrence.title,
                    detail: [occurrence.space_label, occurrence.slot_type === "activity" ? "Activity" : null]
                        .filter(Boolean).join(" · ") || occurrence.class_label,
                    status_label: starts <= at.getTime() && ends > at.getTime() ? "Now" : "Next",
                    time_label: timeLabel,
                    starts_at: new Date(occurrence.starts_at).toISOString(),
                    ends_at: new Date(occurrence.ends_at).toISOString(),
                    local_date: occurrence.occurrence_date,
                    href: teachingAssignment
                        ? query("/areas/timetable/session", { date: localDate, class_section_id: occurrence.class_domain_id, period_number: String(occurrence.period_number) })
                        : recordAssignment
                            ? query("/areas/attendance/registers", { date: localDate, class_section_id: occurrence.class_domain_id })
                            : query("/areas/timetable/schedule", { date: localDate, class_section_id: occurrence.class_domain_id }),
                    action_label: teachingAssignment ? "Open session" : recordAssignment ? "Open register" : "Open timetable",
                    source_label: occurrence.source_domain === "day_plan" ? "Published day plan" : "Published timetable",
                    tone: starts <= at.getTime() && ends > at.getTime() ? "info" : "neutral",
                },
            });
        }
        for (const relationship of snapshot.relationships) {
            if (!relationship.class_section_id || relationship.class_section_id !== occurrence.class_domain_id)
                continue;
            const subject = relationship.relationship === "self" ? "My" : relationship.student_label;
            candidates.push({
                starts,
                ends,
                record: {
                    id: `schedule:${relationship.relationship}:${relationship.student_id}:${occurrence.occurrence_id}`,
                    title: occurrence.subject_label ?? occurrence.title,
                    detail: [subject, occurrence.class_label, occurrence.space_label, occurrence.responsible_agent_label]
                        .filter(Boolean).join(" · "),
                    status_label: starts <= at.getTime() && ends > at.getTime() ? "Now" : "Next",
                    time_label: timeLabel,
                    starts_at: new Date(occurrence.starts_at).toISOString(),
                    ends_at: new Date(occurrence.ends_at).toISOString(),
                    local_date: occurrence.occurrence_date,
                    href: query("/areas/timetable/schedule", {
                        scope: relationship.relationship,
                        student_id: relationship.student_id,
                        date: localDate,
                    }),
                    action_label: "Open timetable",
                    source_label: occurrence.source_domain === "day_plan" ? "Published day plan" : "Published timetable",
                    tone: starts <= at.getTime() && ends > at.getTime() ? "info" : "neutral",
                },
            });
        }
    }
    const now = candidates.filter((candidate) => candidate.starts <= at.getTime() && candidate.ends > at.getTime())
        .sort((left, right) => left.starts - right.starts || left.record.title.localeCompare(right.record.title))
        .slice(0, 5).map((candidate) => candidate.record);
    const upcoming = candidates.filter((candidate) => candidate.starts > at.getTime())
        .sort((left, right) => left.starts - right.starts || left.record.title.localeCompare(right.record.title));
    const firstUpcoming = upcoming[0]?.starts ?? null;
    const next = upcoming.filter((candidate) => firstUpcoming !== null && candidate.starts === firstUpcoming)
        .slice(0, 5).map((candidate) => candidate.record);
    return { now, next, representedAssignments };
}
function relationshipScope(item) {
    return [
        { kind: item.relationship, id: item.student_id, label: item.student_label },
        ...(item.class_section_id ? [{
                kind: "class",
                id: item.class_section_id,
                ...(item.class_label ? { label: item.class_label } : {}),
            }] : []),
    ];
}
function areas(snapshot, workItems, hasExistingFinanceAuthority = false, assignmentDiscovery = { can_setup: false, contexts: [] }, financeDiscovery = { can_record_charge: false, accounts: [] }, resourcesDiscovery = { can_manage: false, can_issue: false, borrower: false, has_loans: false }, facilitiesDiscovery = { can_manage: false, can_report: false, has_repairs: false }, accommodationDiscovery = { can_manage: false, can_offer: false, has_stays: false }, diningDiscovery = { can_manage: false, has_services: false, has_published_sessions: false }, staffDiscovery = { has_personal_staff_work: false, can_review_staff_leave: false, coverage_available: false, source_revisions: [] }, visitsDiscovery = { can_manage: false, has_shared: false, has_questions: false }, careDiscovery = { can_report: false, can_manage_team: false, has_assignments: false }) {
    const definitions = allWorkspaceAreaDefinitions();
    const accumulators = new Map();
    const surfaceContributions = (key, capability, relationship, contributedScopes) => {
        if (key === "facilities")
            return [{ key: "repairs", label: "Repairs & maintenance",
                    description: "Report a problem, follow its owner and check the result", href: "/areas/facilities" }];
        if (key === "accommodation")
            return [{ key: "stays", label: "Accommodation",
                    description: "Review stays, record moves and settle temporary access", href: "/areas/accommodation" }];
        if (key === "dining")
            return [{ key: "services", label: "Dining",
                    description: "See menus and serving hours, and follow service work", href: "/areas/dining" }];
        if (key === "resources")
            return [{ key: capability === "resources.view" ? "mine" : "loans",
                    label: capability === "resources.view" ? "My borrowing" : "Resources & borrowing",
                    description: capability === "resources.view" ? "Your borrowed items, due dates and questions" : "Record issues, inspect returns and answer borrowing questions",
                    href: capability === "resources.view" ? "/areas/resources?view=mine" : "/areas/resources" }];
        if (key === "messages" && capability === "learning.assignments.manage")
            return contributedScopes.filter(scope => scope.kind === "class" && scope.id).map(scope => ({
                key: `assignments:class:${scope.id}`, label: `${scope.label ?? "Class"} assignments`, description: "Publish assignments and review submitted work",
                href: query("/areas/messages/assignments", { scope: "class", class_section_id: scope.id }),
            }));
        if (key === "messages" && capability === "learning.work.publish")
            return contributedScopes.filter(scope => scope.kind === "class" && scope.id).map(scope => ({
                key: `diary:class:${scope.id}`, label: `${scope.label ?? "Class"} practice`, description: "Publish practice for this assigned class",
                href: query("/areas/messages/diary", { scope: "class", class_section_id: scope.id }),
            }));
        if (relationship) {
            const definition = definitions.find((entry) => entry.key === key);
            const relationshipKey = `${relationship.relationship}:${relationship.student_id}`;
            if (key === "messages") {
                const scope = {
                    scope: relationship.relationship,
                    student_id: relationship.student_id,
                };
                const subject = relationship.relationship === "self" ? "My" : relationship.student_label;
                return [
                    {
                        key: `conversations:${relationshipKey}`,
                        label: `${subject} conversations`,
                        description: relationship.relationship === "self"
                            ? "Secure conversations connected to me"
                            : `Secure school conversations about ${relationship.student_label}`,
                        href: query("/areas/messages/conversations", scope),
                    },
                    {
                        key: `updates:${relationshipKey}`,
                        label: `${subject} updates`,
                        description: relationship.relationship === "self"
                            ? "School notices, requested responses and delivery history for me"
                            : `School notices, responses and delivery history for ${relationship.student_label}`,
                        href: query("/areas/messages/updates", scope),
                    },
                    {
                        key: `diary:${relationshipKey}`,
                        label: `${subject} diary`,
                        description: relationship.relationship === "self"
                            ? "Homework, learning notes and class updates for me"
                            : `Homework, learning notes and class updates for ${relationship.student_label}`,
                        href: query("/areas/messages/diary", scope),
                    },
                    {
                        key: `assignments:${relationshipKey}`,
                        label: `${subject} assignments`,
                        description: relationship.relationship === "self" ? "Drafts, submitted work and instructor feedback" : `Submitted work and instructor feedback for ${relationship.student_label}`,
                        href: query("/areas/messages/assignments", scope),
                    },
                ];
            }
            if (key === "attendance") {
                const scope = {
                    scope: relationship.relationship,
                    student_id: relationship.student_id,
                };
                const self = relationship.relationship === "self";
                const subject = self ? "My" : relationship.student_label;
                return [
                    {
                        key: `records:${relationshipKey}`,
                        label: `${subject} attendance`,
                        description: self
                            ? "Attendance records connected to me"
                            : `Attendance records for ${relationship.student_label}`,
                        href: query("/areas/attendance/records", scope),
                    },
                    {
                        key: `leave:${relationshipKey}`,
                        label: `${subject} leave`,
                        description: self
                            ? "Apply for leave and follow each decision"
                            : `Apply, authorize and follow leave for ${relationship.student_label}`,
                        href: query("/areas/attendance/leave", scope),
                    },
                    ...(relationship.relationship === "dependent" ? [{
                            key: `follow-ups:${relationshipKey}`,
                            label: `${subject} attendance questions`,
                            description: `Reply to attendance questions and follow each resolution for ${relationship.student_label}`,
                            href: query("/areas/attendance/follow-ups", scope),
                        }] : []),
                ];
            }
            if (key === "insights") {
                const scope = {
                    scope: relationship.relationship,
                    student_id: relationship.student_id,
                };
                const self = relationship.relationship === "self";
                return [{
                        key: `overview:${relationshipKey}`,
                        label: self ? "My insights" : `${relationship.student_label} insights`,
                        description: self
                            ? "My recorded attendance and published learning trends"
                            : `Recorded attendance and published learning trends for ${relationship.student_label}`,
                        href: query("/areas/insights", scope),
                    }];
            }
            const relationshipSurface = {
                timetable: { key: "schedule", href: "/areas/timetable/schedule" },
                calendar: { key: "calendar", href: "/areas/calendar" },
                assessments: { key: "results", href: "/areas/assessments/results" },
                events: { key: "calendar", href: "/areas/events/calendar" },
                reports: { key: "progress", href: "/areas/reports/progress" },
                fees: { key: "account", href: "/areas/fees/account" },
                departure: { key: "plan", href: "/areas/departure/plan" },
            }[key] ?? { key: "view", href: definition.href };
            const href = query(relationshipSurface.href, {
                scope: relationship.relationship,
                student_id: relationship.student_id,
            });
            const self = relationship.relationship === "self";
            const subject = self ? "My" : relationship.student_label;
            const label = key === "attendance"
                ? `${subject} attendance`
                : key === "timetable"
                    ? `${subject} timetable`
                    : `${subject} ${definition.label.toLowerCase()}`;
            return [{
                    key: `${relationshipSurface.key}:${relationshipKey}`,
                    label,
                    description: self
                        ? `${definition.description} for me`
                        : `${definition.description} for ${relationship.student_label}`,
                    href,
                }];
        }
        if (key === "attendance") {
            if (capability.startsWith("followups.") || capability.includes("coordination")) {
                return [{ key: "coordination", label: "Attendance follow-up", description: "Resolve attendance questions and exceptions", href: "/areas/attendance/coordination" }];
            }
            return [
                { key: "registers", label: "Registers", description: "Assigned activities and participant registers", href: "/areas/attendance/registers" },
                { key: "thresholds", label: "Attendance patterns", description: "Learners below the configured attendance minimum in your scope", href: "/areas/attendance/thresholds" },
            ];
        }
        if (key === "timetable") {
            if (capability === "learning.sessions.manage")
                return [{ key: "sessions", label: "Teaching sessions", description: "Prepare, teach and return to your session records", href: "/areas/timetable/session" }];
            const canPlan = /(^|\.)(manage|plan|publish|configure)$/.test(capability);
            return [canPlan
                    ? { key: "planning", label: "Timetable planning", description: "Plan and publish authorized schedules", href: "/areas/timetable/planning" }
                    : { key: "schedule", label: "My schedule", description: "Current and upcoming sessions", href: "/areas/timetable/schedule" }];
        }
        if (key === "calendar") {
            const canPlan = /(^|\.)(manage|plan|publish|configure)$/.test(capability);
            return [canPlan
                    ? { key: "manage", label: "Campus calendar", description: "Campus dates and authorized schedules", href: "/areas/calendar?surface=manage" }
                    : { key: "assigned", label: "Activity calendar", description: "Scheduled activities available through your current responsibilities", href: "/areas/calendar?surface=assigned" }];
        }
        if (key === "in-out" && capability === "gate.visits.shared")
            return [
                { key: "visits", label: "Visits", description: "Your shared visit details and questions", href: "/areas/in-out/visits" },
            ];
        if (key === "in-out")
            return [
                { key: "visits", label: "Visits", description: "Arrange a visit and keep its time, place and contact together", href: "/areas/in-out/visits" },
                { key: "operate", label: "Record movements", description: "Record authorized arrivals, departures and visitors", href: "/areas/in-out/operate" },
                ...(snapshot.membership_roles.includes("admin") ? [{ key: "manage", label: "Manage entry points", description: "Review passes, visitor decisions and operating records", href: "/areas/in-out/manage" }] : []),
            ];
        if (key === "people") {
            if (capability === "members.invite")
                return [{ key: "invitations", label: "Account invitations", description: "Give an existing campus person login access", href: "/more/setup/people/invitations" }];
            if (capability === "attendance.view" || capability === "attendance.record")
                return [{
                        key: "classes",
                        label: "Classes & rosters",
                        description: "Assigned classes, enrolled learners, lessons and recent class work",
                        href: "/areas/people/classes",
                    }];
            return [
                { key: "participants", label: "People & groups", description: "One directory of campus people, their groups and connections", href: "/areas/people/participants" },
                // Authorized compatibility/tool surfaces, not competing people directories.
                { key: "records", label: "Enrollment records", description: "Review academic enrollment and its own recorded history", href: "/areas/people/records" },
                { key: "import", label: "Enroll from file", description: "Review and commit an academic enrollment import", href: "/areas/people/import" },
            ];
        }
        if (key === "fees")
            return [{ key: "ledger", label: "Fees & receipts", description: "Maintain invoices, payments and reconciliation records", href: "/areas/fees/ledger" }];
        if (key === "assistant")
            return [{
                    key: "conversation",
                    label: "ThatCampus AI",
                    description: "Ask, understand and act within your current authorized context",
                    href: "/areas/assistant/conversation",
                }];
        if (key === "messages")
            return [
                { key: "conversations", label: "Conversations", description: "Secure conversations within your current responsibility", href: "/areas/messages/conversations" },
                { key: "updates", label: "Updates", description: "Publish notices, review delivery and collect authorized responses", href: "/areas/messages/updates" },
            ];
        if (key === "assessments") {
            const manages = capability.includes("moderate") || capability.includes("manage");
            return [manages
                    ? { key: "manage", label: "Assessment coordination", description: "Plan, moderate and coordinate authorized assessments", href: "/areas/assessments/manage" }
                    : { key: "assigned", label: "Assessments & marking", description: "Assigned assessments, invigilation and marking", href: "/areas/assessments/assigned" }];
        }
        if (key === "events") {
            const manages = capability.includes("manage");
            return [manages
                    ? { key: "manage", label: "Event coordination", description: "Create and coordinate authorized campus events", href: "/areas/events/manage" }
                    : { key: "assigned", label: "Assigned events", description: "Activities and event work assigned to you", href: "/areas/events/assigned" }];
        }
        if (key === "reports")
            return [{ key: "remarks", label: "Reports & remarks", description: "Authorized learning reports and remarks", href: "/areas/reports/remarks" }];
        if (key === "insights")
            return [capability === "insights.manage"
                    ? { key: "institution", label: "Institution insights", description: "Institution, attendance, learning, operations and finance review", href: "/areas/insights?scope=institution" }
                    : { key: "assigned", label: "My work insights", description: "Trends within your current attendance and assessment responsibility", href: "/areas/insights?scope=assigned" }];
        if (key === "departure") {
            const manages = capability.includes("manage");
            return [manages
                    ? { key: "manage", label: "Departure coordination", description: "Routes, rosters, handover and journey coordination", href: "/areas/departure/manage" }
                    : { key: "operate", label: "Assigned journey", description: "Operate your assigned route and rider roster", href: "/areas/departure/operate" }];
        }
        if (key === "responsibilities")
            return [
                { key: "mine", label: "My responsibilities", description: "Current, scheduled and historical assigned work", href: "/areas/responsibilities/mine" },
                { key: "coverage", label: "Coverage", description: "Cover offers, accepted cover and authorized gaps", href: "/areas/responsibilities/coverage" },
                { key: "leave", label: "Staff leave", description: "Personal leave requests, balances and authorized review", href: "/areas/responsibilities/leave" },
            ];
        if (key === "care")
            return [{ key: "concerns", label: "Student concerns", description: "Report and review concerns within your responsibility", href: "/areas/care/concerns" }];
        const definition = definitions.find((entry) => entry.key === key);
        return [{ key: "workspace", label: definition.label, description: definition.description, href: `${definition.href}/workspace` }];
    };
    const add = (key, capability, scopes, relationship = null, nativeContributions) => {
        const definition = definitions.find((entry) => entry.key === key);
        if (!definition)
            return;
        const entry = accumulators.get(key) ?? {
            definition,
            capabilities: new Set(),
            scopes: [],
            attention: 0,
            surfaces: new Map(),
        };
        entry.capabilities.add(capability);
        entry.scopes.push(...scopes);
        for (const contribution of nativeContributions ?? surfaceContributions(key, capability, relationship, scopes)) {
            const selected = entry.surfaces.get(contribution.key) ?? {
                ...contribution,
                capabilities: new Set(),
                scopes: [],
            };
            selected.capabilities.add(capability);
            selected.scopes.push(...scopes);
            entry.surfaces.set(selected.key, selected);
        }
        accumulators.set(key, entry);
        // Keep navigation eligibility identical to the existing schedule/calendar
        // authority. This projects the same evidence; it does not grant Calendar or
        // Timetable actions, infer a role, or consult another execution environment.
        if (key === "timetable" && capability !== "learning.sessions.manage")
            add("calendar", capability, scopes, relationship);
    };
    for (const assignment of snapshot.assignments) {
        const definition = workspaceAreaForCapability(assignment.action_key) ?? workspaceAreaForCapability(assignment.capability_key);
        if (definition)
            add(definition.key, assignment.action_key, [assignment.scope]);
        if (assignment.action_key === "learning.work.publish" && assignment.scope.kind === "class")
            add("messages", assignment.action_key, [assignment.scope]);
        if (assignment.action_key === "learning.assignments.manage" && assignment.scope.kind === "class")
            add("messages", assignment.action_key, [assignment.scope]);
        if (assignment.scope.kind === "class"
            && (assignment.action_key === "attendance.view" || assignment.action_key === "attendance.record")) {
            add("people", assignment.action_key, [assignment.scope]);
        }
        if (assignment.action_key === "attendance.view" || assignment.action_key.startsWith("assessments.")) {
            add("insights", assignment.action_key, [assignment.scope]);
        }
    }
    for (const relationship of snapshot.relationships) {
        for (const key of relationshipAreaKeys[relationship.relationship]) {
            add(key, `${key}.view`, relationshipScope(relationship), relationship);
        }
    }
    // Discovery follows the holder's current native authority; an administrator
    // title alone never contributes a Finance operating context.
    if (hasExistingFinanceAuthority)
        add("fees", "fees.manage", [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }]);
    // A leave decision holder needs a way to configure delivery before the first
    // request exists. This contributes only review, never generic staff management.
    if (staffDiscovery.can_review_staff_leave)
        add("responsibilities", "staff.leave.review", [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }], null, [{
                key: "leave", label: "Staff leave", description: "Review requests and arrange cover", href: "/areas/responsibilities/leave",
            }]);
    if (staffDiscovery.has_personal_staff_work) {
        const own = [{ kind: "self", label: "My staff work" }];
        add("responsibilities", "staff.responsibilities.view", own, null, [{ key: "mine", label: "My responsibilities",
                description: "Your current assignments and offers", href: "/areas/responsibilities/mine" }]);
        add("responsibilities", "staff.leave.view", own, null, [{ key: "leave", label: "My leave",
                description: "Request time off and follow its approval", href: "/areas/responsibilities/leave" }]);
    }
    if (staffDiscovery.coverage_available)
        add("responsibilities", "coverage.view", snapshot.membership_roles.includes("admin")
            ? [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }] : [{ kind: "self", label: "My cover records" }], null, [{
                key: "coverage", label: "Cover duties", description: "Your cover offers and arrangements", href: "/areas/responsibilities/coverage",
            }]);
    // Recording an obligation is separate from authority to approve a payment plan.
    if (financeDiscovery.can_record_charge)
        add("fees", "fees.manage", [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }]);
    if (resourcesDiscovery.can_manage || resourcesDiscovery.can_issue)
        add("resources", "resources.manage", [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }]);
    if (resourcesDiscovery.borrower && resourcesDiscovery.has_loans)
        add("resources", "resources.view", [{ kind: "self", label: "My borrowing" }]);
    if (facilitiesDiscovery.can_manage || facilitiesDiscovery.can_report || facilitiesDiscovery.has_repairs)
        add("facilities", facilitiesDiscovery.can_manage ? "facilities.manage" : "facilities.view", [{ kind: "self", label: "My repairs" }]);
    if (visitsDiscovery.has_shared || visitsDiscovery.has_questions)
        add("in-out", "gate.visits.shared", [{ kind: "self", label: "My visits" }]);
    if (visitsDiscovery.can_manage)
        add("in-out", "gate.manage", [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }]);
    // The Care owner contributes entry/receipt/team eligibility only. No child,
    // allegation, case identifier or broad case-reading grant enters the manifest.
    if (careDiscovery.can_report)
        add("care", "restricted_care.intake", [{ kind: "self", label: "My protected concerns" }]);
    if (careDiscovery.has_assignments)
        add("care", "restricted_care.assigned.view", [{ kind: "self", label: "My protected assignments" }]);
    if (careDiscovery.can_manage_team)
        add("care", "restricted_care.team.manage", [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }]);
    if (accommodationDiscovery.can_manage || accommodationDiscovery.can_offer || accommodationDiscovery.has_stays)
        add("accommodation", accommodationDiscovery.can_manage || accommodationDiscovery.can_offer ? "accommodation.manage" : "accommodation.view", [{ kind: "self", label: "My accommodation" }]);
    if (diningDiscovery.can_manage || diningDiscovery.has_services || diningDiscovery.has_published_sessions) {
        add("dining", diningDiscovery.can_manage ? "dining.manage" : "dining.view", [{ kind: "self", label: "Dining services" }]);
        add("calendar", "dining.view", [{ kind: "institution", id: snapshot.institution.id, label: "Published dining hours" }], null, [{
                key: "availability", label: "Dining hours", description: "Published food availability; no venue reservation or diner assignment", href: "/areas/calendar?surface=availability",
            }]);
    }
    for (const account of financeDiscovery.accounts)
        add("fees", "fees.view", [{ kind: "person", id: account.person_id, label: account.label }], null, [{
                key: `account:person:${account.person_id}`, label: "My fees & receipts",
                description: "Charges, agreed payment dates and verified receipts within your current invoice access", href: account.href,
            }]);
    // These contexts are revalidated by Learning for the current actor and world.
    // Their discovery metadata is not a generic member or campus teaching grant.
    for (const context of assignmentDiscovery.contexts) {
        const capability = context.can_manage || context.can_publish ? "learning.assignments.manage"
            : context.can_review ? "learning.assignments.review" : "learning.assignments.view";
        add("messages", capability, [{ kind: context.kind, id: context.id, label: context.label }], null, [{
                key: `assignments:${context.kind}:${context.id}`,
                label: context.kind === "person" ? "My assignments" : `${context.label} assignments`,
                description: context.kind === "person" ? "Your work, submissions and instructor feedback"
                    : "Assignments and submitted work within your current teaching responsibility",
                href: context.href,
            }]);
    }
    if (assignmentDiscovery.can_setup)
        add("messages", "learning.assignments.setup", [{ kind: "institution", id: snapshot.institution.id, label: snapshot.institution.name }], null, [{
                key: "assignments:setup", label: "Assignments", description: "Start a learning group and appoint its teaching responsibility",
                href: "/areas/messages/assignments",
            }]);
    if (snapshot.membership_roles.includes("admin")) {
        const institutionScope = {
            kind: "institution",
            id: snapshot.institution.id,
            label: snapshot.institution.name,
        };
        // Schedule planning is authorized by the active administrator relationship
        // in the owning service. Reflect that same authority in the manifest so the
        // progressive setup guide never sends an administrator to a hidden route.
        add("timetable", "schedule.manage", [institutionScope]);
        // These services already accept current institution administrators. Expose
        // their setup/read surfaces without inventing recording appointments.
        add("people", "sis.manage", [institutionScope]);
        add("attendance", "attendance.view", [institutionScope]);
        add("insights", "insights.manage", [institutionScope]);
    }
    for (const item of workItems) {
        if (item.direction === "waiting")
            continue;
        const path = new URL(item.href, "https://thatcampus.invalid").pathname;
        const match = path.match(/^\/areas\/([^/]+)/);
        if (match?.[1]) {
            const area = accumulators.get(match[1]);
            if (area)
                area.attention += 1;
        }
    }
    return definitions.flatMap((definition) => {
        const item = accumulators.get(definition.key);
        const sharedVisitsOnly = definition.key === "in-out" && item?.capabilities.has("gate.visits.shared")
            && !item.capabilities.has("gate.manage") && item.surfaces.size === 1 && item.surfaces.has("visits");
        return item ? [{
                key: definition.key,
                label: sharedVisitsOnly ? "Visits" : definition.label,
                description: sharedVisitsOnly ? "Your shared visit plans and questions" : definition.description,
                href: definition.href,
                icon: definition.icon,
                attention_count: item.attention,
                capabilities: [...item.capabilities].sort(),
                scopes: uniqueWorkspaceScopes(item.scopes),
                surfaces: [...item.surfaces.values()].map((surface) => ({
                    key: surface.key,
                    label: surface.label,
                    description: surface.description,
                    href: surface.href,
                    capabilities: [...surface.capabilities].sort(),
                    scopes: uniqueWorkspaceScopes(surface.scopes),
                })),
            }] : [];
    });
}
function hasCapability(snapshot, ...keys) {
    return snapshot.assignments.some((assignment) => keys.includes(assignment.action_key)
        || keys.includes(assignment.capability_key));
}
function setupLinks(snapshot) {
    const administrator = snapshot.membership_roles.includes("admin");
    const records = administrator || hasCapability(snapshot, "sis.manage");
    const invitations = administrator || hasCapability(snapshot, "members.invite");
    return [
        ...(records ? [{ key: "institution", label: "Campus setup", description: "Spaces, academics, operating rules and administrative history", href: "/more/setup/institution", icon: "building" }] : []),
        ...(records || invitations ? [{ key: "people", label: "People & access", description: "Connect people, records and account access", href: "/more/setup/people", icon: "people" }] : []),
        ...(invitations ? [{ key: "invitations", label: "Invitations", description: "Invite members and review delivery or revocation history", href: "/more/setup/people/invitations", icon: "people" }] : []),
        ...(administrator ? [
            { key: "organization", label: "Organization", description: "Describe departments, teams and reporting lines", href: "/more/setup/organization", icon: "building" },
            { key: "responsibilities", label: "Responsibilities", description: "Assign effective work, scope and fallback", href: "/more/setup/responsibilities", icon: "work" },
        ] : []),
        ...(records ? [{ key: "capabilities", label: "Capabilities", description: "Add campus operations progressively and review readiness", href: "/more/setup/capabilities", icon: "settings" }] : []),
    ];
}
function moreGroups(snapshot, environmentView) {
    const administrator = snapshot.membership_roles.includes("admin");
    const hasLearnerRelationship = snapshot.relationships.length > 0;
    const feedbackCapabilities = [
        ...(administrator ? ["teacher_feedback.coordinate"] : []),
        ...(hasLearnerRelationship ? ["teacher_feedback.respond"] : []),
    ];
    const feedbackScopes = [
        ...(administrator ? [{
                kind: "institution",
                id: snapshot.institution.id,
                label: snapshot.institution.name,
            }] : []),
        ...snapshot.relationships.map((relationship) => ({
            kind: relationship.relationship,
            id: relationship.student_id,
            label: relationship.student_label,
        })),
    ];
    const setup = setupLinks(snapshot);
    // Connections stay authority-scoped in every environment. Simulation routes
    // use the contained effect sinks and authenticated run-local previews; their
    // presence here never grants access to Live provider credentials or delivery.
    const hasConnectionScope = administrator || snapshot.assignments.length > 0 || snapshot.relationships.length > 0;
    const groups = [
        ...(snapshot.institution ? [{
                key: "campus",
                label: "Your campus",
                items: [{ key: "virtual-campus", label: "Virtual campus", description: administrator ? "Explore campus places, expected activity and recorded evidence" : "Explore your campus, buildings and shared places", href: "/more/virtual-campus", icon: "building" }],
            }] : []),
        {
            key: "account",
            label: "Account",
            items: [
                { key: "account", label: "Profile & appearance", description: "Personal preferences, assistant settings and this device's appearance", href: "/more/account", icon: "settings" },
                { key: "security", label: "Account security", description: "Email verification and two-step protection", href: "/more/account/security", icon: "settings" },
            ],
        },
        ...(hasConnectionScope ? [{
                key: "connections",
                label: "Connections",
                items: [{
                        key: "connections",
                        label: environmentView.mode === "simulation" ? "Contained connections" : "Connected apps",
                        description: environmentView.mode === "simulation"
                            ? "Run-local previews and contained integration evidence; nothing is delivered to Live providers"
                            : "Calendar sync and supported assistant messaging apps",
                        href: "/more/connections",
                        icon: "calendar",
                    }],
            }] : []),
        ...(snapshot.assignments.length ? [{
                key: "work",
                label: "My work record",
                items: [{ key: "responsibilities", label: "My responsibilities", description: "Current, upcoming and previous effective assignments", href: "/areas/responsibilities/mine", icon: "work" }],
            }] : []),
        {
            key: "participation",
            label: "Policies & feedback",
            items: [
                { key: "policies", label: "Policies & acknowledgements", description: "Read the versions published to your current institution relationship", href: "/more/policies", icon: "work" },
                ...(feedbackCapabilities.length
                    ? [{
                            key: "feedback",
                            label: "Teaching feedback",
                            description: feedbackCapabilities.length > 1
                                ? "Coordinate check-ins and answer requests available through your learner relationships"
                                : administrator
                                    ? "Coordinate teaching check-ins and review protected results"
                                    : "Answer teaching check-ins available through your learner relationships",
                            href: "/more/feedback",
                            icon: "messages",
                            capabilities: feedbackCapabilities,
                            scopes: uniqueWorkspaceScopes(feedbackScopes),
                        }]
                    : []),
                ...(administrator ? [{ key: "governance", label: "Policies & governance", description: "Institution authority, policy register, profile and history", href: "/more/governance", icon: "work" }] : []),
            ],
        },
        ...(administrator ? [{
                key: "oversight",
                label: "Campus oversight",
                items: [
                    {
                        key: "simulation",
                        label: "Simulation",
                        description: "Explore a temporary, isolated copy of your campus without changing Live records",
                        href: "/more/simulation",
                        icon: "simulation",
                    },
                    { key: "verification", label: "Organization verification", description: "Review or update the institution's non-blocking verification", href: "/more/verification", icon: "settings" },
                ],
            }] : []),
        ...(setup.length ? [{
                key: "setup",
                label: "Campus setup",
                items: [{
                        key: "setup",
                        label: "Campus setup",
                        description: "Choose the next campus outcome, then connect only the people, places and rules it needs",
                        href: "/more/setup",
                        icon: "settings",
                    }],
            }] : []),
    ];
    return groups.filter((group) => group.items.length > 0);
}
function manifestRevision(snapshot, items, nativeSources = []) {
    const sources = [
        snapshot.realm_id,
        snapshot.environment_namespace_id,
        ...nativeSources,
        ...snapshot.assignments.map((item) => `${item.id}:${item.revision}:${item.source_revision}`).sort(),
        ...snapshot.relationships.map((item) => `${item.relationship}:${item.student_id}:${item.enrollment_revision ?? 0}`).sort(),
        ...items.map((item) => `${item.id}:${item.status_label ?? ""}:${item.urgency}:${item.direction ?? "needs_me"}:${item.source?.revision ?? ""}`).sort(),
    ];
    return `workspace-${createHash("sha256").update(sources.join("|")).digest("hex").slice(0, 20)}`;
}
let WorkspaceService = class WorkspaceService {
    repository;
    clock;
    requests;
    temporal;
    activities;
    staffLeave;
    learning;
    financeArrangements;
    feeAuthority;
    nativeFeeReviews;
    resources;
    facilities;
    accommodation;
    dining;
    visits;
    care;
    // Shared across manifests, not one budget per request: concurrent tabs must
    // not multiply native transactions until the Simulation pool is all waiters.
    projectionReads = new WorkspaceProjectionReads();
    constructor(repository, clock, requests, temporal, activities, staffLeave, learning, financeArrangements, feeAuthority, nativeFeeReviews, resources, facilities, accommodation, dining, visits, care) {
        this.repository = repository;
        this.clock = clock;
        this.requests = requests;
        this.temporal = temporal;
        this.activities = activities;
        this.staffLeave = staffLeave;
        this.learning = learning;
        this.financeArrangements = financeArrangements;
        this.feeAuthority = feeAuthority;
        this.nativeFeeReviews = nativeFeeReviews;
        this.resources = resources;
        this.facilities = facilities;
        this.accommodation = accommodation;
        this.dining = dining;
        this.visits = visits;
        this.care = care;
    }
    async manifest(user, executionEnvironment, environmentView) {
        const schoolId = user.active_school_id;
        if (!schoolId)
            throw new BadRequestException("Choose an institution before opening your workspace.");
        if (environmentView.institution_id !== schoolId) {
            throw new BadRequestException("The selected execution environment does not match this institution.");
        }
        // Read the school first through a minimal repository snapshot at the
        // server-owned execution clock. The request cannot choose its environment.
        const provisional = this.clock.now();
        const sourceSnapshot = await this.repository.load({
            user_id: user.id,
            school_id: schoolId,
            at: provisional,
            execution_environment: executionEnvironment,
        });
        const reading = this.clock.read({ institution_id: schoolId, time_zone: sourceSnapshot.institution.timezone });
        const at = reading.instant;
        const limited = sourceSnapshot.access_scope === 'assigned_work';
        const activity = !limited && this.activities ? await this.activities.load(user, sourceSnapshot, at, reading.local_date) : { assignments: [], now: [], next: [], work: [] };
        const snapshot = { ...sourceSnapshot, assignments: [...sourceSnapshot.assignments, ...activity.assignments] };
        let hasExistingFinanceAuthority = false;
        const nativeSources = [];
        // An existing scoped Finance responsibility already contributes its surface.
        // This extra read covers an administrative holder confirming a pre-existing
        // mandate, without forcing that person through a duplicate role assignment.
        if (this.feeAuthority && snapshot.membership_roles.includes("admin")) {
            try {
                const authority = await this.feeAuthority.workspace(user, schoolId);
                hasExistingFinanceAuthority = authority.candidates.some(candidate => candidate.can_confirm)
                    || authority.route.state === "ready" && authority.route.reviewer?.user_id === user.id;
                if (hasExistingFinanceAuthority)
                    nativeSources.push(`fee-authority:${JSON.stringify({ route: authority.route, candidates: authority.candidates.map(candidate => ({ id: candidate.mandate_id, expected: candidate.expected })) })}`);
            }
            catch (error) {
                if (!(error instanceof ForbiddenException))
                    throw error;
            }
        }
        const messageWork = snapshot.messages.filter(message => !hasNativeWorkflowProjection(message)).map((message) => work(message, at, snapshot.institution.timezone));
        const [assignments, arrangements, assignmentReadiness, nativeReviews, financeDiscovery, resourcesWork, resourcesDiscovery, repairWork, facilitiesDiscovery, staysWork, accommodationDiscovery, diningItems, diningDiscovery, visitQuestions, visitsDiscovery, careDiscovery] = await Promise.all([
            this.projectionReads.run(() => !limited && this.learning ? this.learning.projectWork(user) : []),
            this.projectionReads.run(() => !limited && this.financeArrangements ? this.financeArrangements.work(user, schoolId) : { needs_me: [], waiting: [] }),
            this.projectionReads.run(() => !limited && this.learning ? this.learning.readiness(user) : null),
            this.projectionReads.run(() => !limited && this.nativeFeeReviews ? this.nativeFeeReviews.work(user, schoolId) : { needs_me: [], waiting: [] }),
            this.projectionReads.run(() => !limited && this.financeArrangements?.discovery ? this.financeArrangements.discovery(user, schoolId) : { can_record_charge: false, accounts: [] }),
            this.projectionReads.run(() => !limited && this.resources ? this.resources.work(user, schoolId) : { needs_me: [], waiting: [] }),
            this.projectionReads.run(() => !limited && this.resources ? this.resources.discovery(user, schoolId) : { can_manage: false, can_issue: false, borrower: false, has_loans: false }),
            this.projectionReads.run(() => this.facilities ? this.facilities.work(user, schoolId) : { needs_me: [], waiting: [] }),
            this.projectionReads.run(() => this.facilities ? this.facilities.discovery(user, schoolId) : { can_manage: false, can_report: false, has_repairs: false }),
            this.projectionReads.run(() => !limited && this.accommodation ? this.accommodation.work(user, schoolId) : { needs_me: [], waiting: [] }),
            this.projectionReads.run(() => !limited && this.accommodation ? this.accommodation.discovery(user, schoolId) : { can_manage: false, can_offer: false, has_stays: false }),
            this.projectionReads.run(() => !limited && this.dining ? this.dining.work(user, schoolId) : { needs_me: [], waiting: [] }),
            this.projectionReads.run(() => !limited && this.dining ? this.dining.discovery(user, schoolId) : { can_manage: false, has_services: false, has_published_sessions: false }),
            this.projectionReads.run(() => this.visits ? this.visits.work(user, schoolId) : { needs_me: [], waiting: [] }),
            this.projectionReads.run(() => this.visits ? this.visits.discovery(user, schoolId) : { can_manage: false, has_shared: false, has_questions: false }),
            this.projectionReads.run(() => !limited && this.care ? this.care.discovery(user, schoolId) : { can_report: false, can_manage_team: false, has_assignments: false }),
        ]);
        nativeSources.push(`finance-discovery:${JSON.stringify(financeDiscovery)}`);
        nativeSources.push(`resources-discovery:${JSON.stringify(resourcesDiscovery)}`);
        nativeSources.push(`facilities-discovery:${JSON.stringify(facilitiesDiscovery)}`);
        nativeSources.push(`accommodation-discovery:${JSON.stringify(accommodationDiscovery)}`);
        nativeSources.push(`dining-discovery:${JSON.stringify(diningDiscovery)}`);
        nativeSources.push(`visits-discovery:${JSON.stringify(visitsDiscovery)}`);
        nativeSources.push(`care-discovery:${JSON.stringify(careDiscovery)}`);
        const diningAvailability = !limited && this.dining
            ? await this.dining.ownedAvailability(user, schoolId, { from: reading.local_date, until: reading.local_date })
            : { items: [], warnings: [] };
        nativeSources.push(`dining-availability:${JSON.stringify({ items: diningAvailability.items.map(item => ({
                id: item.id, source_id: item.source_id, source_revision: item.source_revision,
                state: item.state, starts_at: item.starts_at, ends_at: item.ends_at, updated_at: item.updated_at,
            })), warnings: diningAvailability.warnings ?? [] })}`);
        const diningSchedule = diningTodayRecords(diningAvailability, at);
        const assignmentDiscovery = assignmentReadiness
            ? { can_setup: assignmentReadiness.can_setup, contexts: assignmentReadiness.contexts }
            : { can_setup: false, contexts: [] };
        if (assignmentReadiness)
            nativeSources.push(`assignments:${JSON.stringify({ ...assignmentDiscovery,
                operation: { state: assignmentReadiness.operation.state, action: assignmentReadiness.operation.action,
                    scope: assignmentReadiness.operation.scope, source_revision: assignmentReadiness.operation.source_revision } })}`);
        const domainRequests = !limited && this.requests
            ? await this.requests.workspaceItems(user, {
                school_id: schoolId,
                environment_namespace_id: snapshot.environment_namespace_id,
                recorded_at: reading.iso_instant,
                school_name: snapshot.institution.name,
                timezone: snapshot.institution.timezone,
                membership_roles: snapshot.membership_roles,
                relationships: snapshot.relationships,
                assignments: snapshot.assignments,
            })
            : [];
        const incoming = [...messageWork, ...domainRequests.map((item) => requestWork(item, at, snapshot.institution.timezone)), ...activity.work,
            ...assignments.filter(item => item.stream === "needs_me").map(item => assignmentWork(item, at, snapshot.institution.timezone)),
            ...arrangements.needs_me.map(item => financeArrangementWork(item, "needs_me", at, snapshot.institution.timezone)),
            ...nativeReviews.needs_me.map(item => nativeFeeReviewWork(item, "needs_me")),
            ...resourcesWork.needs_me.map(item => resourceLoanWork(item, "needs_me")),
            ...repairWork.needs_me.map(item => facilitiesWork(item, "needs_me")),
            ...staysWork.needs_me.map(item => accommodationWork(item, "needs_me")),
            ...diningItems.needs_me.map(item => diningWork(item, "needs_me")),
            ...visitQuestions.needs_me.map(item => visitQuestionWork(item, "needs_me"))];
        const leaveIds = incoming.filter(item => item.source?.kind === "staff_leave_request" && item.source.action === "decide").map(item => item.source.id);
        const reviewable = !limited && this.staffLeave ? await this.staffLeave.reviewable(user, schoolId, leaveIds, at) : null;
        const permittedIncoming = incoming.filter(item => {
            if (!reviewable || item.source?.kind !== "staff_leave_request" || item.source.action !== "decide")
                return true;
            const retained = reviewable.get(item.source.id);
            return retained && (!item.core_trace || item.core_trace.message_ids.includes(retained.message_id));
        }).map(item => item.source?.kind === "staff_leave_request" && reviewable?.has(item.source.id)
            ? { ...item, source: { ...item.source, revision: reviewable.get(item.source.id).revision } } : item);
        const [waiting, staffDiscovery] = !limited && this.staffLeave ? await Promise.all([
            this.staffLeave.waiting(user, schoolId, at), this.staffLeave.discovery(user, schoolId, at),
        ]) : [[], { has_personal_staff_work: false, can_review_staff_leave: false, coverage_available: false, source_revisions: [] }];
        nativeSources.push(`staff-discovery:${JSON.stringify(staffDiscovery)}`);
        const workItems = mergeWorkItems(permittedIncoming, [...waiting.map(item => waitingWork(item, snapshot.institution.timezone)),
            ...assignments.filter(item => item.stream === "waiting").map(item => assignmentWork(item, at, snapshot.institution.timezone)),
            ...arrangements.waiting.map(item => financeArrangementWork(item, "waiting", at, snapshot.institution.timezone)),
            ...nativeReviews.waiting.map(item => nativeFeeReviewWork(item, "waiting")),
            ...resourcesWork.waiting.map(item => resourceLoanWork(item, "waiting")),
            ...repairWork.waiting.map(item => facilitiesWork(item, "waiting")),
            ...staysWork.waiting.map(item => accommodationWork(item, "waiting")),
            ...diningItems.waiting.map(item => diningWork(item, "waiting")),
            ...visitQuestions.waiting.map(item => visitQuestionWork(item, "waiting"))], snapshot.environment_namespace_id);
        const needsMe = workItems.filter(item => item.direction !== "waiting");
        const operatingDay = !limited && this.temporal
            ? await this.temporal.listOperatingDay({
                school_id: schoolId,
                date: reading.local_date,
                recorded_as_of: reading.iso_instant,
            })
            : [];
        const domainSchedule = operatingDayRecords(snapshot, operatingDay, at, reading.local_date);
        const scheduled = scheduledResponsibilities(snapshot.assignments.filter((assignment) => !domainSchedule.representedAssignments.has(assignment.id)), at);
        const overdue = needsMe.filter((item) => item.urgency === "overdue" || item.urgency === "critical").length;
        const dueSoon = needsMe.filter((item) => item.urgency === "due_soon").length;
        const newestSource = snapshot.messages.reduce((latest, item) => !latest || item.updated_at > latest ? item.updated_at : latest, null);
        const asOf = new Intl.DateTimeFormat("en", {
            timeZone: snapshot.institution.timezone,
            hour: "numeric",
            minute: "2-digit",
        }).format(at);
        const dateLabel = new Intl.DateTimeFormat("en", {
            timeZone: snapshot.institution.timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
        }).format(at);
        const classLabels = [...new Set(snapshot.relationships.map((item) => item.class_label).filter((item) => Boolean(item)))];
        const revision = manifestRevision(snapshot, workItems, nativeSources);
        const more = moreGroups(snapshot, environmentView).filter(group => !limited || group.key === 'account');
        // Older clients still consume the detailed setup catalogue. The grouped
        // experience intentionally exposes one Campus setup entry that opens the
        // composed setup journey rather than six competing shortcuts.
        const setup = limited ? [] : setupLinks(snapshot);
        const other = more.filter((group) => group.key !== "setup").flatMap((group) => group.items);
        return {
            revision,
            generated_at: executionNow().toISOString(),
            context: {
                actor_user_id: user.id,
                institution_id: schoolId,
                institution_label: snapshot.institution.name,
                time_zone: snapshot.institution.timezone,
                access_scope: limited ? 'assigned_work' : 'campus',
                scope_label: classLabels.length === 1 ? classLabels[0] : null,
                date_label: dateLabel,
                environment: environmentView.mode === "simulation" && !environmentView.unavailable
                    ? {
                        kind: "simulation",
                        namespace_id: environmentView.namespace_id,
                        virtual_now: environmentView.virtual_clock.now,
                        expires_at: environmentView.expires_at,
                    }
                    : { kind: "live", namespace_id: environmentView.namespace_id },
            },
            today: {
                now: [...domainSchedule.now, ...activity.now, ...diningSchedule.now, ...scheduled.now].slice(0, 5),
                attention: { total: needsMe.length, overdue, due_soon: dueSoon },
                next: upcomingWorkspaceRecords([...domainSchedule.next, ...activity.next, ...diningSchedule.next, ...scheduled.next]).slice(0, 5),
                completed_automatically: [],
            },
            work: { total: workItems.length, counts: { needs_me: needsMe.length, waiting: workItems.length - needsMe.length }, coverage: "complete", items: workItems },
            areas: areas(snapshot, workItems, hasExistingFinanceAuthority, assignmentDiscovery, financeDiscovery, resourcesDiscovery, facilitiesDiscovery, accommodationDiscovery, diningDiscovery, staffDiscovery, visitsDiscovery, careDiscovery).filter(area => !limited || area.key === 'facilities' || area.key === 'in-out'),
            more: {
                groups: more,
                // Compatibility fields remain until every deployed client reads grouped
                // contributions. They are a transport bridge, not a second catalogue.
                setup,
                other,
            },
            freshness: {
                state: "current",
                as_of: asOf,
                source_revision: revision,
                source_updated_at: newestSource,
            },
        };
    }
};
WorkspaceService = __decorate([
    Injectable(),
    __param(1, Inject(EXECUTION_CLOCK_PORT)),
    __param(2, Optional()),
    __param(3, Optional()),
    __param(3, Inject(TEMPORAL_CONTEXT_PORT)),
    __param(4, Optional()),
    __param(5, Optional()),
    __param(6, Optional()),
    __param(7, Optional()),
    __param(8, Optional()),
    __param(9, Optional()),
    __param(10, Optional()),
    __param(11, Optional()),
    __param(12, Optional()),
    __param(13, Optional()),
    __param(14, Optional()),
    __param(15, Optional()),
    __metadata("design:paramtypes", [WorkspaceRepository, Object, RequestsService, Object, ActivityWorkspaceProjection,
        StaffLeaveWorkProjection,
        LearningAssignmentsService,
        FinanceArrangementsReadService,
        FeeAuthorityService,
        NativeFeeReviewsService,
        ResourceLoansService,
        FacilitiesService,
        AccommodationService,
        DiningService,
        VisitSharingService,
        RestrictedCareService])
], WorkspaceService);
export { WorkspaceService };
//# sourceMappingURL=workspace.service.js.map