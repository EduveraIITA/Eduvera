export type ScenarioScalar = string | number | boolean | null;
export type ScenarioValue =
  | ScenarioScalar
  | ScenarioValue[]
  | { readonly [key: string]: ScenarioValue };

export type ScenarioExecutionMode = "rehearsal" | "simulation";

export interface ScenarioTimeRange {
  from: string;
  to: string;
}

export interface ScenarioConfigurationRef {
  kind: "operating_rule" | "behaviour" | "domain_configuration";
  key: string;
  version_id: string;
  configuration_hash: string;
  effective_from: string;
  effective_until: string | null;
}

export interface ScenarioBehaviourPolicy {
  policy_id: string;
  version_id: string;
  configuration_hash: string;
  effective_from: string;
  effective_until: string | null;
  calibration: {
    method: string;
    calibrated_at: string;
    sample_size: number | null;
    window: ScenarioTimeRange | null;
  };
  parameters: ScenarioValue;
}

export interface HumanAgentIdentity {
  kind: "human";
  human_agent_id: string;
  person_id: string;
}

export type NonHumanAgentKind = "team" | "device" | "integration" | "software";
export type ScenarioSourceAgentKind = "human" | NonHumanAgentKind;

export interface NonHumanAgentIdentity {
  kind: NonHumanAgentKind;
  agent_id: string;
  external_ref: string;
}

/**
 * A stable identity copied from the live Model Core agent registry. It is a
 * reference to the source actor only; it carries no live credential, endpoint or
 * authority into the scenario namespace.
 */
export type ScenarioSourceAgentIdentity = HumanAgentIdentity | NonHumanAgentIdentity;

export interface DelegateAgentIdentity {
  kind: "delegate";
  delegate_agent_id: string;
  acts_for_human_agent_id: string;
  authority_snapshot_ref: string;
}

export interface ScenarioPersonaIdentity {
  kind: "scenario_persona";
  scenario_persona_id: string;
  scenario_id: string;
  source_human_agent_id: string;
  behaviour_policy_version_id: string | null;
}

/**
 * Run-local counterpart for any source agent. Counterparts are isolated actors,
 * not aliases or impersonations of the live source agent.
 */
export interface ScenarioCounterpartIdentity {
  kind: "scenario_counterpart";
  scenario_counterpart_id: string;
  scenario_id: string;
  source_agent_id: string;
  source_agent_kind: ScenarioSourceAgentKind;
  behaviour_policy_version_id: string | null;
}

export interface ScenarioCounterpartIdentityMapping {
  source: ScenarioSourceAgentIdentity;
  delegates: readonly DelegateAgentIdentity[];
  counterpart: ScenarioCounterpartIdentity;
}

/**
 * Compatibility input for the first human-only scenario slice. New snapshots
 * must emit ScenarioCounterpartIdentityMapping instead.
 */
export interface LegacyHumanScenarioIdentityMapping {
  human: HumanAgentIdentity;
  delegates: readonly DelegateAgentIdentity[];
  persona: ScenarioPersonaIdentity;
}

export type ScenarioIdentityMapping =
  | ScenarioCounterpartIdentityMapping
  | LegacyHumanScenarioIdentityMapping;

export type ScenarioSideEffectKind =
  | "scenario_event"
  | "scenario_message"
  | "scenario_artifact"
  | "production_command"
  | "production_message"
  | "external_notification"
  | "connector_call"
  | "production_evidence_write"
  | "production_authority_lookup";

export interface ScenarioSideEffectRequest {
  kind: ScenarioSideEffectKind;
  target_namespace_id: string;
  target_ref: string | null;
}

export interface ScenarioSideEffectPolicy {
  readonly mode: "sink_only";
  permits(request: ScenarioSideEffectRequest): boolean;
  assertPermitted(request: ScenarioSideEffectRequest): void;
}

export interface DeterministicRandom {
  readonly seed: string;
  next(): number;
  integer(minimum: number, maximum: number): number;
  normal(mean: number, standardDeviation: number): number;
  fork(label: string): DeterministicRandom;
}

export interface VirtualClock {
  now(): Date;
  nowIso(): string;
  advanceBy(milliseconds: number): string;
  advanceTo(instant: string): string;
}

interface ScenarioMessageBase {
  id: string;
  scenario_id: string;
  namespace_id: string;
  run_id: string;
  protocol: string;
  payload: ScenarioValue;
  sent_at: string;
}

export interface ScenarioCounterpartMessage extends ScenarioMessageBase {
  sender_counterpart_id: string;
  recipient_counterpart_id: string;
  sender_persona_id?: never;
  recipient_persona_id?: never;
}

/** Compatibility envelope for human-only callers from the first scenario slice. */
export interface LegacyScenarioPersonaMessage extends ScenarioMessageBase {
  sender_persona_id: string;
  recipient_persona_id: string;
  sender_counterpart_id?: never;
  recipient_counterpart_id?: never;
}

export type ScenarioMessage = ScenarioCounterpartMessage | LegacyScenarioPersonaMessage;

export interface ScenarioArtifactInput {
  kind: string;
  payload: ScenarioValue;
  occurred_at: string;
}

export interface ScenarioArtifact extends ScenarioArtifactInput {
  scenario_id: string;
  namespace_id: string;
  run_id: string;
}

export interface ScenarioMessageDispatcher {
  readonly mode: "sink_only";
  dispatch(message: ScenarioMessage): void;
  messages(): readonly ScenarioMessage[];
}

export interface ScenarioEvidenceStore {
  put(key: string, value: ScenarioValue): void;
  get(key: string): ScenarioValue | null;
  entries(): Readonly<Record<string, ScenarioValue>>;
}

export interface ScenarioIdentityResolver {
  resolveCounterpart(scenarioCounterpartId: string): ScenarioCounterpartIdentity | null;
  counterpartForSource(sourceAgentId: string): ScenarioCounterpartIdentity | null;
  sourceForCounterpart(scenarioCounterpartId: string): ScenarioSourceAgentIdentity | null;
  /** @deprecated Human-only compatibility adapter. */
  resolvePersona(scenarioPersonaId: string): ScenarioPersonaIdentity | null;
  /** @deprecated Human-only compatibility adapter. */
  personaForHuman(humanAgentId: string): ScenarioPersonaIdentity | null;
  /** @deprecated Human-only compatibility adapter. */
  humanForPersona(scenarioPersonaId: string): HumanAgentIdentity | null;
  delegate(delegateAgentId: string): DelegateAgentIdentity | null;
}

export interface ScenarioExecutionContext {
  readonly mode: ScenarioExecutionMode;
  readonly namespace_id: string;
  readonly institution_id: string;
  readonly scenario_id: string;
  readonly run_id: string;
  readonly deterministic_seed: string;
  readonly clock: VirtualClock;
  readonly random: DeterministicRandom;
  readonly identity_resolver: ScenarioIdentityResolver;
  readonly configuration_snapshot: readonly ScenarioConfigurationRef[];
  readonly message_dispatcher: ScenarioMessageDispatcher;
  readonly evidence_store: ScenarioEvidenceStore;
  readonly side_effect_policy: ScenarioSideEffectPolicy;
}

export type ScenarioMetricMap = Readonly<Record<string, number | null>>;

export interface ScenarioUnsupportedCapability {
  domain: string;
  capability: string;
  reason: string;
}

export interface ScenarioPlan<TIntervention extends ScenarioValue = ScenarioValue> {
  key: "baseline" | "alternative";
  label: string;
  intervention: TIntervention | null;
}

export interface ScenarioExecutorInput<
  TSnapshot extends ScenarioValue = ScenarioValue,
  TIntervention extends ScenarioValue = ScenarioValue,
> {
  context: ScenarioExecutionContext;
  snapshot: TSnapshot;
  horizon: ScenarioTimeRange;
  plan: ScenarioPlan<TIntervention>;
  sample: {
    kind: "deterministic" | "monte_carlo";
    index: number | null;
    behaviour_policy: ScenarioBehaviourPolicy | null;
  };
}

export interface ScenarioExecutorOutput {
  metrics: ScenarioMetricMap;
  artifacts: readonly ScenarioArtifactInput[];
  assumptions: readonly string[];
  unsupported: readonly ScenarioUnsupportedCapability[];
}

/**
 * A scenario executor is supplied by an owning domain adapter. It must be pure with
 * respect to production infrastructure: all time, randomness, messages and evidence
 * are supplied by the scenario context, and unsupported behavior is explicit.
 */
export interface PureScenarioExecutor<
  TSnapshot extends ScenarioValue = ScenarioValue,
  TIntervention extends ScenarioValue = ScenarioValue,
> {
  readonly executor_id: string;
  readonly version: string;
  execute(input: ScenarioExecutorInput<TSnapshot, TIntervention>): Promise<ScenarioExecutorOutput>;
}

export interface ScenarioRunRequest<
  TSnapshot extends ScenarioValue = ScenarioValue,
  TIntervention extends ScenarioValue = ScenarioValue,
> {
  mode: ScenarioExecutionMode;
  scenario_id: string;
  namespace_id: string;
  institution_id: string;
  run_id: string;
  requested_at: string;
  expires_at: string;
  deterministic_seed: string;
  source: {
    snapshot: TSnapshot;
    snapshot_version: string;
    snapshot_at: string;
    source_revisions: Readonly<Record<string, string>>;
  };
  horizon: ScenarioTimeRange;
  configuration_snapshot: readonly ScenarioConfigurationRef[];
  identities: readonly ScenarioIdentityMapping[];
  assumptions: readonly string[];
  baseline: ScenarioPlan<TIntervention> & { key: "baseline" };
  alternative: ScenarioPlan<TIntervention> & { key: "alternative" };
  monte_carlo: {
    sample_count: number;
    behaviour_policy: ScenarioBehaviourPolicy;
  } | null;
}

export interface ScenarioMetricComparison {
  baseline: number | null;
  alternative: number | null;
  delta: number | null;
  delta_percent: number | null;
}

export interface ScenarioExecutionResult {
  plan: "baseline" | "alternative";
  label: string;
  metrics: ScenarioMetricMap;
  artifacts: readonly ScenarioArtifact[];
  messages: readonly ScenarioMessage[];
  assumptions: readonly string[];
  unsupported: readonly ScenarioUnsupportedCapability[];
}

export interface ScenarioQuantileRange {
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface ScenarioMetricEnsemble {
  baseline: ScenarioQuantileRange;
  alternative: ScenarioQuantileRange;
  delta: ScenarioQuantileRange;
}

export interface ScenarioRunResult {
  schema_version: 1;
  mode: ScenarioExecutionMode;
  scenario_id: string;
  namespace_id: string;
  institution_id: string;
  run_id: string;
  requested_at: string;
  expires_at: string;
  snapshot_hash: string;
  snapshot_version: string;
  snapshot_at: string;
  source_revisions: Readonly<Record<string, string>>;
  deterministic_seed: string;
  horizon: ScenarioTimeRange;
  executor: { id: string; version: string };
  configuration_snapshot: readonly ScenarioConfigurationRef[];
  assumptions: readonly string[];
  unsupported: readonly ScenarioUnsupportedCapability[];
  baseline: ScenarioExecutionResult;
  alternative: ScenarioExecutionResult;
  comparison: Readonly<Record<string, ScenarioMetricComparison>>;
  ensemble: {
    status: "not_calibrated" | "calibrated";
    sample_count: number;
    behaviour_policy: ScenarioBehaviourPolicy | null;
    metrics: Readonly<Record<string, ScenarioMetricEnsemble>>;
  };
}

export interface ScenarioEngine {
  run<
    TSnapshot extends ScenarioValue,
    TIntervention extends ScenarioValue,
  >(
    request: ScenarioRunRequest<TSnapshot, TIntervention>,
    executor: PureScenarioExecutor<TSnapshot, TIntervention>,
  ): Promise<ScenarioRunResult>;
}

export interface ScenarioRunStore {
  save(result: ScenarioRunResult): void;
  get(institutionId: string, runId: string): ScenarioRunResult | null;
  delete(institutionId: string, runId: string): boolean;
  sweepExpired(): number;
  size(): number;
}
