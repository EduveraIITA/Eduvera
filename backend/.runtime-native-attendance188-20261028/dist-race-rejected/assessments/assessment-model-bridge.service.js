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
import { CAMPUS_MODEL_CORE_PORT } from "../campus-model-core/campus-model-core.port.js";
function lifecycle(state) {
    if (state === "planning")
        return "planned";
    if (state === "completed" || state === "cancelled")
        return "inactive";
    return "active";
}
function safeMetadata(snapshot) {
    return {
        assessment_id: snapshot.assessmentId,
        title: snapshot.title,
        class_label: snapshot.classLabel,
        subject_label: snapshot.subjectLabel,
        scheduled_start: snapshot.scheduledStart,
        scheduled_end: snapshot.scheduledEnd,
        expected_count: snapshot.expectedCount,
        operation_state: snapshot.state,
        space_id: snapshot.space.id,
    };
}
let AssessmentModelBridgeService = class AssessmentModelBridgeService {
    core;
    constructor(core) {
        this.core = core;
    }
    recordPlan(transaction, snapshot, command) {
        const metadata = safeMetadata(snapshot);
        return this.core.recordAcceptedChange(transaction, {
            school_id: snapshot.schoolId,
            actor_user_id: snapshot.actorUserId,
            command_type: "examination.sitting.plan",
            target: { domain: "assessments", domain_id: snapshot.sittingId },
            idempotency_key: command.idempotencyKey,
            correlation_id: command.correlationId,
            causation_id: command.causationId ?? null,
            expected_revision: command.expectedRevision,
            authority_evidence: [
                `assessment:${snapshot.assessmentId}`,
                `assessment_operation_policy:${snapshot.policyRevision}`,
            ],
            operating_rule_version_ref: `assessment_operation_policy:${snapshot.policyRevision}`,
            source_domain: "assessments",
            safe_context: metadata,
            entities: [
                {
                    kind: "exam_sitting",
                    domain: "assessments",
                    domain_id: snapshot.sittingId,
                    label: snapshot.title,
                    lifecycle_state: lifecycle(snapshot.state),
                    source_revision: snapshot.sittingRevision,
                    metadata,
                },
                {
                    // Reuse the topology entity created by Institute setup.  A bridge must
                    // never change the canonical entity kind while attaching domain work.
                    kind: "space",
                    domain: "campus_topology",
                    domain_id: snapshot.space.id,
                    label: snapshot.space.name,
                    lifecycle_state: "active",
                    source_revision: snapshot.space.revision,
                    metadata: { space_kind: snapshot.space.kind },
                },
            ],
            relationships: [{
                    relation_type: "scheduled_in",
                    source: { domain: "assessments", domain_id: snapshot.sittingId },
                    target: { domain: "campus_topology", domain_id: snapshot.space.id },
                    operation: "set",
                    effective_from: snapshot.scheduledStart,
                    effective_until: snapshot.scheduledEnd,
                    source_domain: "assessments",
                    source_record_id: snapshot.sittingId,
                    source_revision: snapshot.sittingRevision,
                    replace_current: false,
                    metadata,
                }],
            outcome: {
                code: snapshot.state === "ready" ? "exam_sitting_ready" : "exam_sitting_planned",
                explanation: snapshot.state === "ready"
                    ? "The examination sitting has a room, frozen candidates and sufficient invigilation."
                    : "The examination sitting plan was accepted and remains visibly incomplete until readiness checks pass.",
                resulting_revision: snapshot.sittingRevision,
                metadata,
            },
            domain_event_id: command.domainEventId ?? null,
        });
    }
    recordAction(transaction, snapshot, command) {
        const metadata = safeMetadata(snapshot);
        return this.core.recordAcceptedChange(transaction, {
            school_id: snapshot.schoolId,
            actor_user_id: snapshot.actorUserId,
            command_type: `examination.sitting.${command.action}`,
            target: { domain: "assessments", domain_id: snapshot.sittingId },
            idempotency_key: command.idempotencyKey,
            correlation_id: command.correlationId,
            causation_id: command.causationId ?? null,
            expected_revision: command.expectedRevision,
            authority_evidence: [`assessment:${snapshot.assessmentId}`, `exam_sitting:${snapshot.sittingId}`],
            operating_rule_version_ref: `assessment_operation_policy:${snapshot.policyRevision}`,
            source_domain: "assessments",
            safe_context: metadata,
            entities: [{
                    kind: "exam_sitting",
                    domain: "assessments",
                    domain_id: snapshot.sittingId,
                    label: snapshot.title,
                    lifecycle_state: lifecycle(snapshot.state),
                    source_revision: snapshot.sittingRevision,
                    metadata,
                }],
            relationships: [],
            outcome: {
                code: command.action === "start"
                    ? "exam_sitting_started"
                    : command.action === "complete"
                        ? "exam_sitting_completed"
                        : "exam_sitting_cancelled",
                explanation: command.explanation,
                resulting_revision: snapshot.sittingRevision,
                metadata,
            },
            domain_event_id: command.domainEventId ?? null,
        });
    }
    recordAttendance(transaction, snapshot, command) {
        const metadata = { ...safeMetadata(snapshot), recorded_count: command.recordedCount, outstanding_count: command.outstandingCount };
        return this.core.recordAcceptedChange(transaction, {
            school_id: snapshot.schoolId,
            actor_user_id: snapshot.actorUserId,
            command_type: "examination.attendance.record",
            target: { domain: "assessments", domain_id: snapshot.sittingId },
            idempotency_key: command.idempotencyKey,
            correlation_id: command.correlationId,
            causation_id: command.causationId ?? null,
            expected_revision: command.expectedRevision,
            authority_evidence: [`exam_sitting:${snapshot.sittingId}:invigilation`],
            operating_rule_version_ref: `assessment_operation_policy:${snapshot.policyRevision}`,
            source_domain: "assessments",
            safe_context: metadata,
            entities: [{
                    kind: "exam_sitting",
                    domain: "assessments",
                    domain_id: snapshot.sittingId,
                    label: snapshot.title,
                    lifecycle_state: lifecycle(snapshot.state),
                    source_revision: snapshot.sittingRevision,
                    metadata,
                }],
            relationships: [],
            outcome: {
                code: "exam_attendance_recorded",
                explanation: "Candidate attendance observations were recorded without changing academic result outcomes.",
                resulting_revision: snapshot.sittingRevision,
                metadata,
            },
            domain_event_id: command.domainEventId ?? null,
        });
    }
    recordIncident(transaction, snapshot, command) {
        const sittingMetadata = safeMetadata(snapshot);
        const incidentMetadata = {
            assessment_id: snapshot.assessmentId,
            sitting_id: snapshot.sittingId,
            severity: command.severity,
            incident_state: command.action === "resolve" ? "resolved" : "open",
        };
        return this.core.recordAcceptedChange(transaction, {
            school_id: snapshot.schoolId,
            actor_user_id: snapshot.actorUserId,
            command_type: `examination.incident.${command.action}`,
            target: { domain: "assessment_incidents", domain_id: command.incidentId },
            idempotency_key: command.idempotencyKey,
            correlation_id: command.correlationId,
            causation_id: command.causationId ?? null,
            expected_revision: command.expectedRevision,
            authority_evidence: [`exam_sitting:${snapshot.sittingId}:invigilation`],
            operating_rule_version_ref: `assessment_operation_policy:${snapshot.policyRevision}`,
            source_domain: "assessments",
            safe_context: incidentMetadata,
            entities: [
                {
                    kind: "exam_incident",
                    domain: "assessment_incidents",
                    domain_id: command.incidentId,
                    label: `${snapshot.title} incident`,
                    lifecycle_state: command.action === "resolve" ? "inactive" : "active",
                    source_revision: command.incidentRevision,
                    metadata: incidentMetadata,
                },
                {
                    kind: "exam_sitting",
                    domain: "assessments",
                    domain_id: snapshot.sittingId,
                    label: snapshot.title,
                    lifecycle_state: lifecycle(snapshot.state),
                    source_revision: snapshot.sittingRevision,
                    metadata: sittingMetadata,
                },
            ],
            relationships: [{
                    relation_type: "reported_for",
                    source: { domain: "assessment_incidents", domain_id: command.incidentId },
                    target: { domain: "assessments", domain_id: snapshot.sittingId },
                    operation: "set",
                    // Persisted domain time keeps retries deterministic and makes the model
                    // replayable; wall-clock time here would create a new fact on retry.
                    effective_from: command.occurredAt,
                    effective_until: null,
                    source_domain: "assessments",
                    source_record_id: command.incidentId,
                    source_revision: command.incidentRevision,
                    replace_current: true,
                    metadata: incidentMetadata,
                }],
            outcome: {
                code: `exam_incident_${command.action}ed`,
                explanation: command.action === "resolve"
                    ? "The examination incident was resolved with an attributed operational record."
                    : "A factual examination incident was recorded for review.",
                resulting_revision: command.incidentRevision,
                metadata: incidentMetadata,
            },
            domain_event_id: command.domainEventId ?? null,
        });
    }
};
AssessmentModelBridgeService = __decorate([
    Injectable(),
    __param(0, Inject(CAMPUS_MODEL_CORE_PORT)),
    __metadata("design:paramtypes", [Object])
], AssessmentModelBridgeService);
export { AssessmentModelBridgeService };
//# sourceMappingURL=assessment-model-bridge.service.js.map