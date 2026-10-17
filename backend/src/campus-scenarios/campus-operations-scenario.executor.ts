import type {
  PureScenarioExecutor,
  ScenarioExecutorInput,
  ScenarioExecutorOutput,
  ScenarioValue,
} from "../campus-model-core/scenarios/index.js";
import type {
  CampusScenarioInterventionInput,
  CampusScenarioSession,
  CampusScenarioSnapshot,
} from "./scenario-contracts.js";

interface ProjectedSession extends CampusScenarioSession {
  projected_teacher_ref: string | null;
  projected_space_ref: string | null;
  disrupted: boolean;
}

interface ResourceInterval {
  key: string;
  starts_at: string;
  ends_at: string;
  resource_ref: string | null;
}

export function countConflictingIntervals(intervals: readonly ResourceInterval[]): number {
  const groups = new Map<string, ResourceInterval[]>();
  for (const interval of intervals) {
    const key = interval.resource_ref;
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(interval);
    groups.set(key, group);
  }
  const conflicted = new Set<string>();
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));
    let maximumPreviousEnd = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index]!;
      const currentStart = Date.parse(current.starts_at);
      const currentEnd = Date.parse(current.ends_at);
      const next = ordered[index + 1];
      const overlapsPrevious = maximumPreviousEnd > currentStart;
      const overlapsNext = next ? Date.parse(next.starts_at) < currentEnd : false;
      if (overlapsPrevious || overlapsNext) conflicted.add(current.key);
      maximumPreviousEnd = Math.max(maximumPreviousEnd, currentEnd);
    }
  }
  return conflicted.size;
}

function conflictingSessionCount(
  sessions: readonly ProjectedSession[],
  reference: (session: ProjectedSession) => string | null,
): number {
  return countConflictingIntervals(sessions.map((session) => ({
    key: session.occurrence_key,
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    resource_ref: reference(session),
  })));
}

function isSnapshot(value: ScenarioValue): value is ScenarioValue & CampusScenarioSnapshot {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "campus_operations_snapshot"
    && Array.isArray((value as { sessions?: unknown }).sessions));
}

function isIntervention(value: ScenarioValue | null): value is ScenarioValue & CampusScenarioInterventionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as unknown as CampusScenarioInterventionInput;
  return (candidate.type === "teacher_unavailable" || candidate.type === "space_unavailable")
    && typeof candidate.target_id === "string"
    && Number.isFinite(Date.parse(candidate.starts_at))
    && Number.isFinite(Date.parse(candidate.ends_at));
}

function policyNumber(input: ScenarioExecutorInput, key: string): number | null {
  const parameters = input.sample.behaviour_policy?.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return null;
  const value = parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applies(session: CampusScenarioSession, intervention: CampusScenarioInterventionInput): boolean {
  return Date.parse(session.starts_at) < Date.parse(intervention.ends_at)
    && Date.parse(session.ends_at) > Date.parse(intervention.starts_at)
    && (intervention.type === "teacher_unavailable"
      ? session.teacher_agent_id === intervention.target_id
      : session.space_id === intervention.target_id);
}

export class CampusOperationsScenarioExecutor implements PureScenarioExecutor {
  readonly executor_id = "campus_operations_forecast";
  readonly version = "1";

  execute(input: ScenarioExecutorInput): Promise<ScenarioExecutorOutput> {
    if (!isSnapshot(input.snapshot)) throw new Error("Campus scenario executor requires a campus operations snapshot.");
    if (input.plan.key === "alternative" && !isIntervention(input.plan.intervention)) {
      throw new Error("Alternative campus scenario requires a supported intervention.");
    }
    const intervention = isIntervention(input.plan.intervention) ? input.plan.intervention : null;
    const stochastic = input.sample.kind === "monte_carlo" && input.sample.behaviour_policy !== null;
    const probability = intervention?.type === "space_unavailable"
      ? policyNumber(input, "relocation_probability")
      : policyNumber(input, "acceptance_probability");
    const responseMean = policyNumber(input, "response_minutes_mean");
    const responseDeviation = policyNumber(input, "response_minutes_standard_deviation");
    let affected = 0;
    let modelledPositiveResponses = 0;

    const sessions: ProjectedSession[] = input.snapshot.sessions.map((session) => {
      const disrupted = intervention ? applies(session, intervention) : false;
      if (disrupted) affected += 1;
      const wasResolved = disrupted && stochastic && probability !== null
        ? input.context.random.next() < probability
        : false;
      if (wasResolved) modelledPositiveResponses += 1;
      return {
        ...session,
        projected_teacher_ref: disrupted && intervention?.type === "teacher_unavailable"
          ? null
          : session.teacher_agent_id,
        projected_space_ref: disrupted && intervention?.type === "space_unavailable"
          ? null
          : session.space_id,
        disrupted,
      };
    });
    // A positive modelled response is coordination evidence only. Without a
    // concrete eligible assignment, the operational disruption remains open.
    const unresolvedAffected = affected;
    const learnerPlacesDisrupted = sessions.reduce((total, session) => (
      total + (session.disrupted ? session.expected_count : 0)
    ), 0);
    const uncovered = sessions.filter((session) => {
      if (session.projected_teacher_ref) return false;
      const teacherWasRemovedByIntervention = session.disrupted
        && intervention?.type === "teacher_unavailable";
      return !session.teacher_assignment_present || teacherWasRemovedByIntervention;
    }).length;
    const teacherIdentityUnknown = sessions.filter((session) => (
      session.teacher_assignment_present
      && !session.teacher_agent_id
      && !(session.disrupted && intervention?.type === "teacher_unavailable")
    )).length;
    const unplaced = sessions.filter((session) => !session.projected_space_ref).length;
    const overCapacity = sessions.filter((session) => (
      session.projected_space_ref
      && session.space_capacity !== null
      && session.expected_count > session.space_capacity
    )).length;
    const capacityUnknown = sessions.filter((session) => (
      session.projected_space_ref && session.space_capacity === null
    )).length;
    const teacherConflicts = conflictingSessionCount(sessions, (session) => session.projected_teacher_ref);
    const spaceConflicts = conflictingSessionCount(sessions, (session) => session.projected_space_ref);
    const responseMinutes = stochastic && affected > 0 && responseMean !== null && responseDeviation !== null
      ? Math.max(0, input.context.random.normal(responseMean, responseDeviation))
      : null;
    const responseRate = stochastic && affected > 0 ? (modelledPositiveResponses / affected) * 100 : null;

    input.context.side_effect_policy.assertPermitted({
      kind: "scenario_artifact",
      target_namespace_id: input.context.namespace_id,
      target_ref: input.context.run_id,
    });

    const assumptions = [
      "The point-in-time timetable, campus topology and active enrolment counts remain unchanged except for the declared intervention.",
      "Planned timetable location and teacher assignments are expectations, not claims of physical presence.",
      "Each affected session is counted once even when it spans multiple KPI intervals.",
    ];
    if (intervention && !stochastic) {
      assumptions.push(
        "No replacement or relocation is assumed because no reviewed versioned cohort behaviour policy was supplied.",
      );
    }
    if (stochastic) {
      assumptions.push(
        "Response outcomes use only the approved, effective cohort policy captured with the snapshot and the deterministic scenario seed; they do not predict an identified person's intent.",
        "A modelled cohort response does not invent a replacement teacher or room; assignment and conflict relief remain unsupported until an eligible candidate allocator is connected.",
      );
    }

    return Promise.resolve({
      metrics: {
        scheduled_sessions: sessions.length,
        affected_sessions: affected,
        uncovered_sessions: uncovered,
        teacher_identity_unknown_sessions: teacherIdentityUnknown,
        unplaced_sessions: unplaced,
        teacher_conflict_sessions: teacherConflicts,
        space_conflict_sessions: spaceConflicts,
        over_capacity_sessions: overCapacity,
        capacity_unknown_sessions: capacityUnknown,
        learner_places_disrupted: learnerPlacesDisrupted,
        modelled_response_acceptances: modelledPositiveResponses,
        unresolved_intervention_sessions: unresolvedAffected,
        modelled_positive_response_rate_percent: responseRate,
        response_minutes: responseMinutes,
      },
      artifacts: [{
        kind: "campus_scenario_summary",
        occurred_at: input.context.clock.nowIso(),
        payload: {
          plan: input.plan.key,
          scheduled_sessions: sessions.length,
          affected_sessions: affected,
          modelled_response_acceptances: modelledPositiveResponses,
          unresolved_sessions: unresolvedAffected,
        },
      }],
      assumptions,
      unsupported: [
        {
          domain: "resource_allocation",
          capability: "eligible_candidate_assignment",
          reason: "The snapshot does not contain reviewed teacher eligibility or alternative-space constraints, so the scenario never invents a candidate assignment.",
        },
        ...(!stochastic ? [{
          domain: "staff_coordination",
          capability: "cohort_response_forecast",
          reason: "No reviewed versioned cohort behaviour policy was supplied; stochastic ranges are unavailable.",
        }] : []),
      ],
    });
  }
}
