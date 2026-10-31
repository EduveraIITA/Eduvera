var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, } from "@nestjs/common";
import { InMemoryScenarioRunStore, IsolatedScenarioEngine, ScenarioRunStoreCapacityError, } from "../campus-model-core/scenarios/index.js";
import { CampusOperationsScenarioExecutor } from "./campus-operations-scenario.executor.js";
import { CampusScenarioRepository } from "./campus-scenario.repository.js";
import { campusScenarioTargetsQuerySchema, createCampusScenarioSchema, scenarioPolicyConfigurationSchema, } from "./scenario-contracts.js";
const RUN_TTL_MILLISECONDS = 30 * 60 * 1_000;
const MAX_SNAPSHOT_SESSIONS = 5_000;
const MAX_EXECUTION_UNITS = 250_000;
const MAX_CONCURRENT_RUNS = 4;
const MAX_TOTAL_STORED_RUNS = 100;
const MAX_STORED_RUNS_PER_INSTITUTION = 10;
const metricPresentation = {
    scheduled_sessions: {
        label: "Scheduled sessions", unit: "sessions", direction: "neutral",
        explanation: "Effective class and activity sessions in the selected campus during the scenario horizon.",
    },
    affected_sessions: {
        label: "Sessions directly affected", unit: "sessions", direction: "lower",
        explanation: "Sessions overlapping the declared teacher or space unavailability window.",
    },
    uncovered_sessions: {
        label: "Sessions without a teacher", unit: "sessions", direction: "lower",
        explanation: "Planned sessions without an effective teacher after applying this scenario.",
    },
    teacher_identity_unknown_sessions: {
        label: "Teacher identity mappings unavailable", unit: "sessions", direction: "lower",
        explanation: "Sessions that have a source teacher assignment but no stable human-agent mapping in the snapshot.",
    },
    unplaced_sessions: {
        label: "Sessions without a usable space", unit: "sessions", direction: "lower",
        explanation: "Planned sessions without a canonical available space after applying this scenario.",
    },
    teacher_conflict_sessions: {
        label: "Teacher conflict sessions", unit: "conflicts", direction: "lower",
        explanation: "Sessions involved in overlapping assignments for the same effective teacher.",
    },
    space_conflict_sessions: {
        label: "Space conflict sessions", unit: "conflicts", direction: "lower",
        explanation: "Sessions involved in overlapping use of the same canonical campus space.",
    },
    over_capacity_sessions: {
        label: "Over-capacity sessions", unit: "conflicts", direction: "lower",
        explanation: "Sessions whose active enrolment count exceeds the recorded room capacity.",
    },
    capacity_unknown_sessions: {
        label: "Room capacity unavailable", unit: "sessions", direction: "lower",
        explanation: "Placed sessions whose canonical room has no recorded capacity, so capacity risk cannot be evaluated.",
    },
    learner_places_disrupted: {
        label: "Learner places disrupted", unit: "learner_places", direction: "lower",
        explanation: "Learner-session places affected by the declared unavailability; a modelled response alone does not resolve them.",
    },
    modelled_response_acceptances: {
        label: "Modelled cohort responses", unit: "sessions", direction: "higher",
        explanation: "Scenario-only responses sampled from the approved captured cohort policy. They are not assigned teachers, rooms or real acceptances.",
    },
    unresolved_intervention_sessions: {
        label: "Intervention sessions unresolved", unit: "sessions", direction: "lower",
        explanation: "Affected sessions that remain operationally unresolved because no eligible teacher or space was assigned.",
    },
    modelled_positive_response_rate_percent: {
        label: "Modelled positive response rate", unit: "percent", direction: "higher",
        explanation: "Cohort-level positive response likelihood only. It does not mean a teacher or room has been assigned.",
    },
    response_minutes: {
        label: "Estimated response time", unit: "minutes", direction: "lower",
        explanation: "Cohort-level scenario response time. It is not a prediction of an identified person's intent.",
    },
};
function runLocalCounterpartCoverage(snapshot) {
    const counterpartsByKind = {
        human: 0,
        team: 0,
        device: 0,
        integration: 0,
        software: 0,
    };
    const readiness = { modelled: 0, passive: 0, unsupported: 0 };
    let counterpartCount = 0;
    for (const identity of snapshot.identities) {
        if (!("counterpart" in identity))
            continue;
        counterpartCount += 1;
        counterpartsByKind[identity.counterpart.source_agent_kind] += 1;
        readiness[identity.counterpart.readiness] += 1;
    }
    return {
        scope: "captured_active_model_core_agents",
        source_agent_count: snapshot.counts.agents,
        counterpart_count: counterpartCount,
        coverage: counterpartCount === snapshot.counts.agents ? "complete" : "partial",
        counterparts_by_kind: counterpartsByKind,
        readiness,
        behaviour_parity: false,
        explanation: "Counts cover only active Model Core agents captured in this run-local snapshot. Readiness reports registered counterpart behaviour; it does not claim application or real-person parity.",
    };
}
function maximumRevision(reference) {
    if (!reference?.startsWith("max:"))
        return null;
    const value = Number(reference.slice(4));
    return Number.isFinite(value) ? value : null;
}
function unsupportedDomains(result) {
    return [...new Set([
            ...result.unsupported.map((item) => item.domain),
            "attendance_outcomes",
            "gate_movement",
            "transport",
            "finance",
            "assessments",
        ])].sort();
}
let CampusScenarioService = class CampusScenarioService {
    repository;
    engine = new IsolatedScenarioEngine();
    executor = new CampusOperationsScenarioExecutor();
    store = new InMemoryScenarioRunStore({
        now: () => new Date(),
        max_total_runs: MAX_TOTAL_STORED_RUNS,
        max_runs_per_institution: MAX_STORED_RUNS_PER_INSTITUTION,
        max_result_bytes: 2_000_000,
    });
    metadata = new Map();
    activeInstitutions = new Set();
    targetCache = new Map();
    targetLoads = new Map();
    targetLoadInstitutions = new Set();
    activeRunCount = 0;
    constructor(repository) {
        this.repository = repository;
    }
    async assertAdmin(user, schoolId) {
        if (!(await this.repository.hasActiveAdminMembership(user.id, schoolId))) {
            throw new ForbiddenException("An active institution administrator membership is required.");
        }
    }
    sweepMetadata() {
        for (const [runId, metadata] of this.metadata) {
            if (!this.store.get(metadata.school_id, runId))
                this.metadata.delete(runId);
        }
    }
    acquireExecutionSlot(schoolId) {
        if (this.activeRunCount >= MAX_CONCURRENT_RUNS || this.activeInstitutions.has(schoolId)) {
            throw new HttpException("A scenario is already running for this institution, or the temporary scenario runner is busy.", HttpStatus.TOO_MANY_REQUESTS);
        }
        this.activeRunCount += 1;
        this.activeInstitutions.add(schoolId);
    }
    releaseExecutionSlot(schoolId) {
        this.activeInstitutions.delete(schoolId);
        this.activeRunCount = Math.max(0, this.activeRunCount - 1);
    }
    prepareStoreCapacity(schoolId) {
        this.sweepMetadata();
        const evictOldest = (institutionId) => {
            const oldest = [...this.metadata.entries()]
                .filter(([, metadata]) => institutionId === null || metadata.school_id === institutionId)
                .sort(([, left], [, right]) => Date.parse(left.created_at) - Date.parse(right.created_at))[0];
            if (!oldest)
                return false;
            const [runId, metadata] = oldest;
            this.store.delete(metadata.school_id, runId);
            this.metadata.delete(runId);
            return true;
        };
        while ([...this.metadata.values()].filter((metadata) => metadata.school_id === schoolId).length
            >= MAX_STORED_RUNS_PER_INSTITUTION) {
            if (!evictOldest(schoolId))
                break;
        }
        while (this.store.size() >= MAX_TOTAL_STORED_RUNS) {
            if (!evictOldest(null))
                break;
        }
    }
    resolveBehaviourPolicy(record, versionId, snapshotAt) {
        if (!versionId)
            return null;
        if (!record || record.id !== versionId
            || record.behaviour_key !== "scenario_coverage_response_cohort"
            || record.configuration_schema_version !== 1) {
            throw new BadRequestException("The selected scenario behaviour version is not an approved, effective cohort-response policy.");
        }
        const configuration = scenarioPolicyConfigurationSchema.safeParse(record.configuration);
        if (!configuration.success) {
            throw new BadRequestException("The selected scenario behaviour version has an invalid scenario policy configuration.");
        }
        const configured = configuration.data.scenario_policy;
        if (configured.calibration.method !== "historical_coverage_reviewed") {
            throw new BadRequestException("Institution-supplied assumptions cannot be presented as calibrated ranges. Run deterministically or select a historically reviewed policy.");
        }
        if (Date.parse(configured.calibration.calibrated_at) > Date.parse(snapshotAt)) {
            throw new BadRequestException("The scenario behaviour version was calibrated after this snapshot.");
        }
        return {
            policy: {
                policy_id: record.behaviour_key,
                version_id: record.id,
                configuration_hash: record.configuration_hash,
                effective_from: record.effective_from,
                effective_until: record.effective_until,
                calibration: configured.calibration,
                parameters: configured.parameters,
            },
            sample_count: configured.sample_count,
        };
    }
    view(result, metadata) {
        const capacityUnknown = Math.max(result.baseline.metrics.capacity_unknown_sessions ?? 0, result.alternative.metrics.capacity_unknown_sessions ?? 0);
        const teacherIdentityUnknown = Math.max(result.baseline.metrics.teacher_identity_unknown_sessions ?? 0, result.alternative.metrics.teacher_identity_unknown_sessions ?? 0);
        const metrics = Object.entries(metricPresentation).map(([key, presentation]) => {
            const interval = result.ensemble.metrics[key];
            const isStochasticOnly = key === "modelled_response_acceptances"
                || key === "modelled_positive_response_rate_percent"
                || key === "response_minutes";
            const available = !isStochasticOnly || result.ensemble.status === "calibrated";
            const partialReason = key === "over_capacity_sessions" && capacityUnknown > 0
                ? `${capacityUnknown} placed session(s) have no recorded room capacity.`
                : (key === "uncovered_sessions" || key === "teacher_conflict_sessions")
                    && teacherIdentityUnknown > 0
                    ? `${teacherIdentityUnknown} source teacher assignment(s) have no stable human-agent mapping.`
                    : null;
            const unavailableRange = { p10: null, p50: null, p90: null };
            return {
                key,
                ...presentation,
                baseline: available ? (interval?.baseline ?? unavailableRange) : unavailableRange,
                scenario: available ? (interval?.alternative ?? unavailableRange) : unavailableRange,
                availability: !available ? "unavailable"
                    : partialReason ? "partial"
                        : "available",
                unavailable_reason: !available
                    ? "Select an approved, effective cohort behaviour version to calculate stochastic ranges."
                    : partialReason,
            };
        });
        return {
            schema_version: 1,
            evidence_mode: "simulation",
            run: {
                id: result.run_id,
                status: "completed",
                scenario_kind: metadata.scenario_kind,
                created_at: metadata.created_at,
                snapshot_at: result.snapshot_at,
                expires_at: result.expires_at,
                horizon_days: metadata.horizon_days,
                intervention: metadata.intervention,
                assumptions: [...result.assumptions],
                unsupported_domains: unsupportedDomains(result),
                metrics,
                progress: 100,
                failure_reason: null,
                execution_environment: {
                    mode: "simulation",
                    namespace_id: result.namespace_id,
                    run_id: result.run_id,
                    virtual_clock: {
                        now: result.horizon.from,
                        time_zone: metadata.time_zone,
                    },
                    source_snapshot_at: result.snapshot_at,
                    expires_at: result.expires_at,
                },
                projection_capabilities: {
                    application_parity: false,
                    supported: ["campus_performance"],
                    unsupported: [
                        "today",
                        "timetable",
                        "attendance",
                        "requests",
                        "notifications",
                        "campus_view",
                    ],
                },
                run_local_counterpart_coverage: metadata.counterpart_coverage,
                side_effect_policy: {
                    mode: "sink_only",
                    production_writes: false,
                    production_messages: false,
                    production_connectors: false,
                },
                source_snapshot: {
                    hash: result.snapshot_hash,
                    schedule_revision_max: maximumRevision(result.source_revisions.schedule),
                    space_revision_max: maximumRevision(result.source_revisions.spaces),
                    agent_revision_max: maximumRevision(result.source_revisions.agents),
                    coverage_evidence_revision: result.source_revisions.coverage_evidence === "none"
                        ? null : (result.source_revisions.coverage_evidence ?? null),
                    counts: metadata.counts,
                    captured_at: result.snapshot_at,
                    consistency: "repeatable_read_transaction",
                },
                uncertainty_status: result.ensemble.status === "calibrated"
                    ? "calibrated_ensemble"
                    : "deterministic",
                execution_provenance: {
                    deterministic_seed: result.deterministic_seed,
                    executor: result.executor,
                    ensemble_sample_count: result.ensemble.sample_count,
                    identity_manifest_hash: result.identity_manifest_hash,
                    identity_count: result.identity_manifest.identities.length,
                    configuration_ref_count: result.identity_manifest.configuration_refs.length,
                },
                stochastic_policy: result.ensemble.behaviour_policy,
            },
        };
    }
    async targets(user, schoolId, rawQuery) {
        const parsed = campusScenarioTargetsQuerySchema.safeParse(rawQuery);
        if (!parsed.success)
            throw new BadRequestException("Choose a valid campus and 7–30 day horizon.");
        await this.assertAdmin(user, schoolId);
        const [school, campuses] = await Promise.all([
            this.repository.school(schoolId),
            this.repository.campuses(schoolId),
        ]);
        if (!school)
            throw new NotFoundException("Institution not found.");
        const campus = parsed.data.campus_id
            ? campuses.find((candidate) => candidate.id === parsed.data.campus_id)
            : (campuses.find((candidate) => candidate.is_primary) ?? campuses[0]);
        if (!campus)
            throw new NotFoundException("An active campus is required for scenario planning.");
        const cacheKey = `${schoolId}:${campus.id}:${parsed.data.horizon_days}`;
        const cached = this.targetCache.get(cacheKey);
        if (cached && cached.expires_at > Date.now())
            return structuredClone(cached.value);
        const existingLoad = this.targetLoads.get(cacheKey);
        if (existingLoad)
            return structuredClone(await existingLoad);
        if (this.targetLoadInstitutions.has(schoolId) || this.targetLoads.size >= MAX_CONCURRENT_RUNS) {
            throw new HttpException("Scenario target discovery is busy. Try again shortly.", HttpStatus.TOO_MANY_REQUESTS);
        }
        this.targetLoadInstitutions.add(schoolId);
        const load = (async () => {
            const from = new Date().toISOString();
            const to = new Date(Date.parse(from) + parsed.data.horizon_days * 24 * 60 * 60 * 1_000).toISOString();
            const options = await this.repository.targetOptions({
                school_id: schoolId,
                campus_id: campus.id,
                timezone: campus.timezone || school.timezone || "Asia/Kolkata",
                from,
                to,
            });
            if (options.overflow) {
                throw new HttpException(`This target catalogue exceeds the ${MAX_SNAPSHOT_SESSIONS}-session synchronous scenario limit. Choose a shorter horizon.`, HttpStatus.PAYLOAD_TOO_LARGE);
            }
            return {
                schema_version: 1,
                evidence_mode: "simulation",
                campus_id: campus.id,
                horizon_days: parsed.data.horizon_days,
                horizon: { from, to },
                teachers: options.teachers.map((teacher) => ({
                    ...teacher,
                    suggested_date: teacher.session_dates[0] ?? null,
                })),
                spaces: options.spaces.map((space) => ({
                    id: space.id,
                    label: space.label,
                    kind: space.kind,
                    capacity: space.capacity,
                    session_dates: space.session_dates,
                    session_windows: space.session_windows,
                    date_windows: space.date_windows,
                    suggested_date: space.session_dates[0] ?? null,
                    suggested_window: space.suggested_window,
                })),
            };
        })();
        this.targetLoads.set(cacheKey, load);
        try {
            const value = await load;
            if (this.targetCache.size >= 100)
                this.targetCache.delete(this.targetCache.keys().next().value ?? "");
            this.targetCache.set(cacheKey, { expires_at: Date.now() + 60_000, value: structuredClone(value) });
            return structuredClone(value);
        }
        finally {
            this.targetLoads.delete(cacheKey);
            this.targetLoadInstitutions.delete(schoolId);
        }
    }
    async create(user, schoolId, rawInput) {
        const parsed = createCampusScenarioSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new BadRequestException("Choose a valid 7–30 day snapshot or supported intervention.");
        }
        const input = parsed.data;
        const snapshotOnly = input.kind === "baseline_snapshot";
        const interventionInput = snapshotOnly ? null : input.intervention;
        const behaviourPolicyVersionId = snapshotOnly ? undefined : input.behaviour_policy_version_id;
        await this.assertAdmin(user, schoolId);
        this.acquireExecutionSlot(schoolId);
        try {
            this.prepareStoreCapacity(schoolId);
            const [school, campuses] = await Promise.all([
                this.repository.school(schoolId),
                this.repository.campuses(schoolId),
            ]);
            if (!school)
                throw new NotFoundException("Institution not found.");
            const campus = input.campus_id
                ? campuses.find((candidate) => candidate.id === input.campus_id)
                : (campuses.find((candidate) => candidate.is_primary) ?? campuses[0]);
            if (input.campus_id && !campus)
                throw new NotFoundException("The selected active campus was not found.");
            if (!campus && !snapshotOnly) {
                throw new NotFoundException("An active campus is required for an intervention scenario.");
            }
            const createdAt = new Date().toISOString();
            const horizonTo = new Date(Date.parse(createdAt) + input.horizon_days * 24 * 60 * 60 * 1_000).toISOString();
            const target = interventionInput ? await this.repository.resolveTarget(schoolId, campus.id, interventionInput.type, interventionInput.target_id, createdAt) : null;
            if (interventionInput && !target) {
                throw new BadRequestException("The intervention target is not active in the selected campus.");
            }
            if (interventionInput) {
                const interventionStart = Date.parse(interventionInput.starts_at);
                const interventionEnd = Date.parse(interventionInput.ends_at);
                if (interventionEnd <= interventionStart
                    || interventionEnd <= Date.parse(createdAt)
                    || interventionStart < Date.parse(createdAt) - 5 * 60 * 1_000
                    || interventionEnd > Date.parse(horizonTo)) {
                    throw new BadRequestException("The intervention must fall within the selected future horizon.");
                }
            }
            const scenarioId = randomUUID();
            const runId = randomUUID();
            const expiresAt = new Date(Date.parse(createdAt) + RUN_TTL_MILLISECONDS).toISOString();
            const repositorySnapshot = await this.repository.snapshot({
                school_id: schoolId,
                campus_id: campus?.id ?? null,
                timezone: campus?.timezone || school.timezone || "Asia/Kolkata",
                captured_at: createdAt,
                horizon_to: horizonTo,
                target,
                scenario_id: scenarioId,
                run_id: runId,
                behaviour_policy_version_id: behaviourPolicyVersionId ?? null,
            });
            const resolvedPolicy = this.resolveBehaviourPolicy(repositorySnapshot.approved_behaviour_policy, behaviourPolicyVersionId, createdAt);
            if (repositorySnapshot.snapshot.sessions.length > MAX_SNAPSHOT_SESSIONS) {
                throw new HttpException(`This snapshot exceeds the ${MAX_SNAPSHOT_SESSIONS}-session synchronous scenario limit. Narrow the campus or horizon.`, HttpStatus.PAYLOAD_TOO_LARGE);
            }
            if (target?.type === "teacher_unavailable"
                && !repositorySnapshot.snapshot.sessions.some((session) => session.teacher_agent_id === target.id)) {
                throw new BadRequestException("This teacher has no effective sessions in the selected campus and horizon.");
            }
            const canonicalIntervention = interventionInput && target ? {
                ...interventionInput,
                target_id: target.id,
                target_label: target.label,
            } : null;
            if (canonicalIntervention && target) {
                const interventionStart = Date.parse(canonicalIntervention.starts_at);
                const interventionEnd = Date.parse(canonicalIntervention.ends_at);
                const affectedSessionCount = repositorySnapshot.snapshot.sessions.filter((session) => (Date.parse(session.starts_at) < interventionEnd
                    && Date.parse(session.ends_at) > interventionStart
                    && (target.type === "teacher_unavailable"
                        ? session.teacher_agent_id === target.id
                        : session.space_id === target.id))).length;
                if (affectedSessionCount === 0) {
                    throw new BadRequestException("No effective session for this target overlaps the intervention window. Choose one of the target's eligible session windows.");
                }
            }
            const sampleCount = resolvedPolicy?.sample_count ?? 0;
            const executionUnits = repositorySnapshot.snapshot.sessions.length
                * (2 + (sampleCount * 2));
            if (executionUnits > MAX_EXECUTION_UNITS) {
                throw new HttpException("This scenario exceeds the synchronous execution budget. Use a shorter horizon or deterministic mode.", HttpStatus.PAYLOAD_TOO_LARGE);
            }
            let result;
            try {
                result = await this.engine.run({
                    mode: "simulation",
                    scenario_id: scenarioId,
                    namespace_id: `scenario:${scenarioId}:run:${runId}`,
                    institution_id: schoolId,
                    run_id: runId,
                    requested_at: createdAt,
                    expires_at: expiresAt,
                    deterministic_seed: runId,
                    source: {
                        snapshot: repositorySnapshot.snapshot,
                        snapshot_version: "campus_operations_snapshot/v1",
                        snapshot_at: createdAt,
                        source_revisions: repositorySnapshot.source_revisions,
                    },
                    horizon: { from: createdAt, to: horizonTo },
                    configuration_snapshot: [
                        ...repositorySnapshot.configuration_snapshot,
                        ...(resolvedPolicy ? [{
                                kind: "behaviour",
                                key: resolvedPolicy.policy.policy_id,
                                version_id: resolvedPolicy.policy.version_id,
                                configuration_hash: resolvedPolicy.policy.configuration_hash,
                                effective_from: resolvedPolicy.policy.effective_from,
                                effective_until: resolvedPolicy.policy.effective_until,
                            }] : []),
                    ],
                    identities: repositorySnapshot.identities,
                    assumptions: [
                        "The simulation is transient and isolated; it cannot update live campus records.",
                        "Only schedule, staffing, active enrolment counts and canonical-space capacity are connected in this bounded adapter.",
                        ...(snapshotOnly ? [
                            "This snapshot-only run records the supported campus baseline and does not apply an intervention.",
                            "Attendance behaviour and outcomes are not modelled by this adapter.",
                        ] : [
                            "Historical coverage evidence is privacy-minimized cohort evidence and is never activated as behaviour without an explicit versioned policy.",
                        ]),
                        "The point-in-time capture was assembled in one read-only repeatable-read database transaction.",
                    ],
                    baseline: { key: "baseline", label: "Captured baseline", intervention: null },
                    alternative: {
                        key: "alternative",
                        label: canonicalIntervention ? `${canonicalIntervention.target_label} unavailable` : "Captured baseline",
                        intervention: canonicalIntervention ?? { type: "baseline_snapshot" },
                    },
                    monte_carlo: resolvedPolicy ? {
                        sample_count: resolvedPolicy.sample_count,
                        behaviour_policy: resolvedPolicy.policy,
                    } : null,
                }, this.executor);
                this.store.save(result);
            }
            catch (error) {
                if (error instanceof ScenarioRunStoreCapacityError) {
                    throw new HttpException("The temporary scenario workspace is full. Discard an existing run and try again.", HttpStatus.TOO_MANY_REQUESTS);
                }
                throw error;
            }
            const metadata = {
                school_id: schoolId,
                scenario_kind: snapshotOnly ? "baseline_snapshot" : "intervention",
                created_at: createdAt,
                time_zone: repositorySnapshot.snapshot.timezone,
                horizon_days: input.horizon_days,
                intervention: canonicalIntervention,
                counts: repositorySnapshot.counts,
                counterpart_coverage: runLocalCounterpartCoverage(repositorySnapshot),
            };
            this.metadata.set(runId, metadata);
            return this.view(result, metadata);
        }
        finally {
            this.releaseExecutionSlot(schoolId);
        }
    }
    async get(user, schoolId, runId) {
        await this.assertAdmin(user, schoolId);
        this.sweepMetadata();
        const result = this.store.get(schoolId, runId);
        const metadata = this.metadata.get(runId);
        if (!result || !metadata || metadata.school_id !== schoolId) {
            throw new NotFoundException("Scenario run not found or expired.");
        }
        return this.view(result, metadata);
    }
    async resolveAuthorizedRun(input) {
        if (!(await this.repository.hasActiveAdminMembership(input.actor_id, input.institution_id))) {
            throw new ForbiddenException("An active institution administrator membership is required.");
        }
        this.sweepMetadata();
        const result = this.store.get(input.institution_id, input.run_id);
        const metadata = this.metadata.get(input.run_id);
        if (!result || !metadata || metadata.school_id !== input.institution_id)
            return null;
        return {
            institution_id: input.institution_id,
            scenario_id: result.scenario_id,
            run_id: result.run_id,
            namespace_id: result.namespace_id,
            virtual_now: result.horizon.from,
            time_zone: metadata.time_zone,
            source_snapshot_at: result.snapshot_at,
            source_snapshot_ref: `sha256:${result.snapshot_hash}`,
            expires_at: result.expires_at,
        };
    }
    async discard(user, schoolId, runId) {
        await this.assertAdmin(user, schoolId);
        const metadata = this.metadata.get(runId);
        const discarded = metadata?.school_id === schoolId ? this.store.delete(schoolId, runId) : false;
        if (metadata?.school_id === schoolId)
            this.metadata.delete(runId);
        return { schema_version: 1, evidence_mode: "simulation", run_id: runId, discarded };
    }
};
CampusScenarioService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [CampusScenarioRepository])
], CampusScenarioService);
export { CampusScenarioService };
//# sourceMappingURL=campus-scenario.service.js.map