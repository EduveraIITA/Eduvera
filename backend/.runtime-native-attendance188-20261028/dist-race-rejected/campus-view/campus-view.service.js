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
import { campusTimezone } from "../common/campus-timezone.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CAMPUS_MODEL_CORE_PORT } from "../campus-model-core/campus-model-core.port.js";
import { TEMPORAL_CONTEXT_PORT } from "../campus-model-core/temporal-context.port.js";
import { assessmentWorkHref } from "../workspace/canonical-application-links.js";
import { CampusViewRepository, } from "./campus-view.repository.js";
import { campusViewQuerySchema, floorForSpace, generatedSchematic, projectTemporalAssertion, strongestDimension, } from "./contracts.js";
import { campusDayMotionClaims, projectCampusMotion } from "./campus-motion.projection.js";
function assertionTitle(context) {
    if (!context || typeof context !== "object" || !("title" in context))
        return null;
    const title = context.title;
    return typeof title === "string" && title.trim() ? title : null;
}
function localDate(instant, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(instant));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}
function occurrenceState(occurrence, asOf) {
    const now = Date.parse(asOf);
    if (now < new Date(occurrence.starts_at).getTime())
        return "upcoming";
    if (now >= new Date(occurrence.ends_at).getTime())
        return "ended";
    return "in_progress";
}
function publicOccurrence(occurrence, asOf) {
    const activity = occurrence.planning_origin === "activity";
    const targetPath = activity
        ? `/areas/timetable/planning?plan=${encodeURIComponent(occurrence.source_record_id)}&plan_revision=${occurrence.source_revision}`
        : "/areas/timetable/planning";
    return {
        id: occurrence.id,
        occurrence_id: occurrence.occurrence_id,
        space_id: occurrence.space_id,
        title: occurrence.title,
        slot_type: occurrence.slot_type,
        class_label: occurrence.class_label,
        subject_label: occurrence.subject_label,
        teacher: occurrence.responsible_agent_id && occurrence.teacher_label
            ? { id: occurrence.responsible_agent_id, label: occurrence.teacher_label }
            : null,
        expected_count: occurrence.expected_count,
        starts_at: new Date(occurrence.starts_at).toISOString(),
        ends_at: new Date(occurrence.ends_at).toISOString(),
        state: occurrenceState(occurrence, asOf),
        dimension: "expected",
        spatial_claim: "expected_context_only",
        source: {
            label: activity ? "Published activity" : occurrence.source_domain === "day_plan" ? "Published day plan" : "Published timetable",
            domain: occurrence.source_domain,
            record_id: occurrence.source_record_id,
            revision: occurrence.source_revision,
            target_path: targetPath,
        },
    };
}
function gateTotals(rows) {
    return rows.reduce((result, row) => ({
        entries: result.entries + row.entry_count,
        exits: result.exits + row.exit_count,
        accepted_points: result.accepted_points + row.accepted_count,
    }), { entries: 0, exits: 0, accepted_points: 0 });
}
let CampusViewService = class CampusViewService {
    repository;
    temporalContext;
    campusModel;
    constructor(repository, temporalContext, campusModel) {
        this.repository = repository;
        this.temporalContext = temporalContext;
        this.campusModel = campusModel;
    }
    async view(user, schoolId, rawQuery) {
        const parsed = campusViewQuerySchema.safeParse({ school_id: schoolId, ...rawQuery });
        if (!parsed.success)
            throw new BadRequestException("Choose a valid campus and ISO date/time.");
        const query = parsed.data;
        const environment = executionEnvironmentStorage.getStore();
        if (!user.is_active || user.active_school_id !== query.school_id || (environment && environment.institution_id !== query.school_id)) {
            throw new ForbiddenException("Choose this institution and its current world before opening campus operations.");
        }
        if (!(await this.repository.hasActiveAdminMembership(user.id, query.school_id))) {
            throw new ForbiddenException("An active institution administrator membership is required.");
        }
        const [school, campuses] = await Promise.all([
            this.repository.school(query.school_id),
            this.repository.campuses(query.school_id),
        ]);
        if (!school)
            throw new NotFoundException("Institution not found.");
        const selectedCampus = query.campus_id
            ? campuses.find((campus) => campus.id === query.campus_id)
            : campuses.find((campus) => campus.is_primary) ?? campuses[0];
        if (query.campus_id && !selectedCampus)
            throw new NotFoundException("Campus not found in this institution.");
        const generatedAt = executionNow().toISOString();
        const asOf = query.at ?? generatedAt;
        const motionEnvironment = { kind: environment?.kind ?? "live",
            namespace_id: environment?.namespace_id ?? `live:${query.school_id}` };
        const publicCampuses = campuses.map((campus) => ({
            id: campus.id,
            name: campus.name,
            code: campus.code,
            campus_type: campus.campus_type,
            is_primary: campus.is_primary,
            timezone: campus.timezone,
        }));
        if (!selectedCampus) {
            return {
                schema_version: 1,
                school,
                campuses: publicCampuses,
                selected_campus_id: null,
                generated_at: generatedAt,
                as_of: asOf,
                plan: null,
                spaces: [],
                activity: [],
                signals: [],
                day_activity: [],
                operations: null,
                motion: projectCampusMotion({ school_id: query.school_id, campus_id: null, viewer_user_id: user.id,
                    as_of: asOf, environment: motionEnvironment, space_ids: new Set(), claims: [] }),
            };
        }
        const spaceRecords = await this.repository.spaces(query.school_id, selectedCampus.id);
        const spacesById = new Map(spaceRecords.map((space) => [space.id, space]));
        const timezone = campusTimezone(selectedCampus.timezone, school.timezone);
        const [assertionGroups, activity, signals, examExpectations, dayOccurrences, gateActivity, visitorCount] = await Promise.all([
            Promise.all(spaceRecords.map((space) => this.temporalContext.resolveAt({
                school_id: query.school_id,
                at: asOf,
                recorded_as_of: generatedAt,
                subject: { type: "entity", domain: "campus_topology", domain_id: space.id },
            }))),
            this.campusModel.recentActivity(query.school_id, 20),
            this.campusModel.operationalSignals(query.school_id, asOf, 20),
            this.repository.examSpaceExpectations(query.school_id, selectedCampus.id, asOf),
            this.repository.dayOccurrences(query.school_id, selectedCampus.id, asOf, timezone),
            this.repository.gateActivityToday(query.school_id, selectedCampus.id, asOf, timezone),
            this.repository.activeVisitorCount(query.school_id, asOf),
        ]);
        const motionParticipants = await this.repository.motionParticipants(query.school_id, dayOccurrences.map(item => item.id));
        const motionPoints = assertionGroups.flatMap((assertions, index) => assertions.flatMap(assertion => {
            if (assertion.assertion_type !== "direct_observation"
                || !["pending", "accepted"].includes(assertion.observation.state)
                || !["gate.movement", "attendance.capture"].includes(assertion.source.source_type))
                return [];
            return [{ id: assertion.assertion_id, space_id: spaceRecords[index].id, observed_at: assertion.observed_at,
                    dimension: assertion.dimension, source: { domain: assertion.source.source_type,
                        record_id: assertion.source.source_record_id, revision: null } }];
        }));
        const motion = projectCampusMotion({ school_id: query.school_id, campus_id: selectedCampus.id, viewer_user_id: user.id,
            as_of: asOf, environment: motionEnvironment, space_ids: new Set(spaceRecords.map(item => item.id)),
            claims: campusDayMotionClaims(dayOccurrences, motionParticipants), points: motionPoints,
            source_limited: dayOccurrences.length >= 240 || motionParticipants.length > 1024 });
        const publicOccurrences = dayOccurrences.map((occurrence) => publicOccurrence(occurrence, asOf));
        const currentBySpace = new Map();
        const dayBySpace = new Map();
        for (const occurrence of publicOccurrences) {
            const day = dayBySpace.get(occurrence.space_id) ?? [];
            day.push(occurrence);
            dayBySpace.set(occurrence.space_id, day);
            if (occurrence.state !== "in_progress")
                continue;
            const current = currentBySpace.get(occurrence.space_id) ?? [];
            current.push(occurrence);
            currentBySpace.set(occurrence.space_id, current);
        }
        const gateBySpace = new Map();
        for (const point of gateActivity) {
            if (!point.space_id)
                continue;
            const current = gateBySpace.get(point.space_id) ?? [];
            current.push(point);
            gateBySpace.set(point.space_id, current);
        }
        const examsBySpace = new Map();
        for (const expectation of examExpectations) {
            const current = examsBySpace.get(expectation.space_id) ?? [];
            current.push(expectation);
            examsBySpace.set(expectation.space_id, current);
        }
        const spaces = spaceRecords.map((space, index) => {
            const assertions = assertionGroups[index].map((assertion) => projectTemporalAssertion(assertion, asOf));
            assertions.push(...(examsBySpace.get(space.id) ?? []).map((expectation) => ({
                assertion_id: expectation.id,
                dimension: "expected",
                assertion_type: "scheduled_context",
                subject: { type: "entity", id: space.id, label: space.name },
                context: {
                    assessment_id: expectation.assessment_id,
                    sitting_id: expectation.sitting_id,
                    title: expectation.title,
                    class_label: expectation.class_label,
                    subject_label: expectation.subject_label,
                    expected_count: expectation.expected_count,
                },
                certainty: "scheduled",
                valid_from: new Date(expectation.effective_from).toISOString(),
                valid_until: new Date(expectation.effective_until).toISOString(),
                observed_at: null,
                recorded_at: new Date(expectation.recorded_at).toISOString(),
                source: {
                    kind: "domain_plan",
                    label: "Scheduled examination",
                    domain: "assessments",
                    record_id: expectation.assessment_id,
                    revision: expectation.source_revision,
                    evidence_id: expectation.id,
                    captured_by: null,
                },
                freshness: {
                    status: "current_at_as_of",
                    as_of: asOf,
                    age_seconds: null,
                    expires_at: new Date(expectation.effective_until).toISOString(),
                },
                spatial_claim: "expected_context_only",
                target_path: assessmentWorkHref("manage", expectation.assessment_id),
            })));
            const expected = assertions.filter((assertion) => assertion.dimension === "expected");
            const observed = assertions.filter((assertion) => assertion.dimension === "observed");
            const accepted = assertions.filter((assertion) => assertion.dimension === "accepted");
            const expectedNow = currentBySpace.get(space.id) ?? [];
            const gatePoints = gateBySpace.get(space.id) ?? [];
            const mappedGate = gateTotals(gatePoints);
            return {
                id: space.id,
                campus_id: space.campus_id,
                parent_space_id: space.parent_space_id,
                name: space.name,
                code: space.code,
                kind: space.kind,
                capacity: space.capacity,
                ...floorForSpace(space, spacesById),
                state_dimension: strongestDimension(assertions),
                expected_activity: expectedNow[0]?.title ?? assertionTitle(expected[0]?.context),
                expected_now: expectedNow,
                day_activity_count: dayBySpace.get(space.id)?.length ?? 0,
                gate_activity_today: gatePoints.length ? {
                    entries: mappedGate.entries,
                    exits: mappedGate.exits,
                    accepted_points: mappedGate.accepted_points,
                    latest_observed_at: new Date(Math.max(...gatePoints.map((point) => new Date(point.latest_observed_at).getTime()))).toISOString(),
                    dimension: "accepted",
                    spatial_claim: "point_observation_only",
                    source_label: "Accepted gate observations",
                } : null,
                assertions: { expected, observed, accepted },
            };
        });
        const gate = gateTotals(gateActivity);
        const expectedTeacherIds = new Set(publicOccurrences
            .filter((occurrence) => occurrence.state === "in_progress" && occurrence.teacher)
            .map((occurrence) => occurrence.teacher.id));
        const scheduleActivity = publicOccurrences.map((occurrence) => ({
            id: `schedule:${occurrence.id}`,
            occurred_at: occurrence.starts_at,
            ends_at: occurrence.ends_at,
            title: occurrence.subject_label || occurrence.title,
            detail: [occurrence.class_label, spacesById.get(occurrence.space_id)?.name,
                occurrence.teacher ? `Expected: ${occurrence.teacher.label}` : occurrence.class_label ? "Teacher not assigned" : null].filter(Boolean).join(" · "),
            state_dimension: "expected",
            state: occurrence.state,
            source_label: occurrence.source.label,
            spatial_claim: "expected_context_only",
            space_id: occurrence.space_id,
            target_path: occurrence.source.target_path,
        }));
        const gateDayActivity = gateActivity.map((point, index) => ({
            id: `gate:${point.gate_label}:${index}`,
            occurred_at: new Date(point.latest_observed_at).toISOString(),
            ends_at: null,
            title: point.gate_label,
            detail: `${point.entry_count} in · ${point.exit_count} out`,
            state_dimension: "accepted",
            state: "point_event",
            source_label: "Accepted gate observations",
            spatial_claim: "point_observation_only",
            space_id: point.space_id,
            target_path: "/areas/in-out/manage",
        }));
        return {
            schema_version: 1,
            school,
            campuses: publicCampuses,
            selected_campus_id: selectedCampus.id,
            generated_at: generatedAt,
            as_of: asOf,
            motion,
            plan: generatedSchematic(selectedCampus, spaceRecords),
            spaces,
            activity: activity.map((item) => ({
                id: item.id,
                occurred_at: new Date(item.occurred_at).toISOString(),
                kind: item.kind,
                action: item.action,
                subject_label: item.subject_label,
                item_count: item.item_count,
                state: item.state,
                actor_label: item.actor_label,
                scope: { type: "institution", id: query.school_id },
                source: { kind: "model_projection", label: "Recorded campus activity" },
                freshness: {
                    status: "recorded_event",
                    as_of: asOf,
                    age_seconds: Math.max(0, Math.floor((Date.parse(asOf) - new Date(item.occurred_at).getTime()) / 1_000)),
                },
            })),
            signals: signals.map((signal) => ({
                ...signal,
                gate_observed_at: new Date(signal.gate_observed_at).toISOString(),
                expected_from: new Date(signal.expected_from).toISOString(),
                expected_until: new Date(signal.expected_until).toISOString(),
                scope: { type: "institution", id: query.school_id },
                freshness: {
                    status: "bounded_cross_check",
                    as_of: asOf,
                    gate_age_seconds: Math.max(0, Math.floor((Date.parse(asOf) - new Date(signal.gate_observed_at).getTime()) / 1_000)),
                    expires_at: new Date(signal.expected_until).toISOString(),
                },
                evidence: {
                    gate: { dimension: "accepted", spatial_claim: "campus_presence_only", source: "Gate observation" },
                    timetable: { dimension: "expected", spatial_claim: "expected_context_only", source: "Published timetable" },
                    attendance: signal.attendance_status
                        ? { dimension: "accepted", spatial_claim: "participation_only", source: "Attendance decision" }
                        : { dimension: "unknown", spatial_claim: "none", source: null },
                },
            })),
            day_activity: [...scheduleActivity, ...gateDayActivity],
            operations: {
                local_date: localDate(asOf, timezone),
                current_expected_sessions: publicOccurrences.filter((occurrence) => occurrence.state === "in_progress").length,
                expected_teachers: expectedTeacherIds.size,
                gate_movements: {
                    entries: gate.entries,
                    exits: gate.exits,
                    accepted_points: gate.accepted_points,
                    dimension: "accepted",
                    spatial_claim: "point_observation_only",
                    scope: campuses.length === 1 ? "selected_campus" : "institution",
                    source_label: "Accepted gate observations",
                },
                visitors_inside: {
                    count: visitorCount,
                    dimension: "accepted",
                    scope: "institution",
                    source_label: "Gate visitor records",
                },
            },
        };
    }
};
CampusViewService = __decorate([
    Injectable(),
    __param(1, Inject(TEMPORAL_CONTEXT_PORT)),
    __param(2, Inject(CAMPUS_MODEL_CORE_PORT)),
    __metadata("design:paramtypes", [CampusViewRepository, Object, Object])
], CampusViewService);
export { CampusViewService };
//# sourceMappingURL=campus-view.service.js.map