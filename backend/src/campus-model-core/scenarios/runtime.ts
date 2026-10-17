import type {
  DelegateAgentIdentity,
  DeterministicRandom,
  HumanAgentIdentity,
  ScenarioCounterpartIdentity,
  ScenarioConfigurationRef,
  ScenarioEvidenceStore,
  ScenarioExecutionContext,
  ScenarioExecutionMode,
  ScenarioIdentityMapping,
  ScenarioIdentityResolver,
  ScenarioMessage,
  ScenarioMessageDispatcher,
  ScenarioPersonaIdentity,
  ScenarioSideEffectPolicy,
  ScenarioSideEffectRequest,
  ScenarioSourceAgentIdentity,
  ScenarioValue,
  VirtualClock,
} from "./contracts.js";

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty.`);
}

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO date-time.`);
  return parsed;
}

export function cloneScenarioValue<T extends ScenarioValue>(value: T): T {
  return structuredClone(value);
}

export function deepFreezeScenarioValue<T extends ScenarioValue>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreezeScenarioValue(child);
    }
  }
  return value;
}

function seedWords(seed: string): [number, number, number, number] {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = 0xdeadbeef;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    a = Math.imul(a ^ code, 0x85ebca6b);
    b = Math.imul(b ^ code, 0xc2b2ae35);
    c = Math.imul(c ^ code, 0x27d4eb2f);
    d = Math.imul(d ^ code, 0x165667b1);
  }
  return [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
}

/** A deterministic xoshiro128** stream. This is simulation randomness, not security. */
export class SeededRandom implements DeterministicRandom {
  readonly seed: string;
  private state: [number, number, number, number];

  constructor(seed: string) {
    assertNonEmpty(seed, "Deterministic seed");
    this.seed = seed;
    this.state = seedWords(seed);
    if (this.state.every((word) => word === 0)) this.state[0] = 1;
  }

  next(): number {
    const [a, b, c, d] = this.state;
    const product = Math.imul(b, 5) >>> 0;
    const result = Math.imul(((product << 7) | (product >>> 25)) >>> 0, 9) >>> 0;
    const shifted = (b << 9) >>> 0;
    const nextC = (c ^ a) >>> 0;
    const nextD = (d ^ b) >>> 0;
    const nextB = (b ^ nextC) >>> 0;
    const nextA = (a ^ nextD) >>> 0;
    this.state = [
      nextA,
      nextB,
      (nextC ^ shifted) >>> 0,
      ((nextD << 11) | (nextD >>> 21)) >>> 0,
    ];
    return result / 0x1_0000_0000;
  }

  integer(minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
      throw new Error("Random integer bounds must be safe integers with maximum >= minimum.");
    }
    const width = maximum - minimum + 1;
    return minimum + Math.floor(this.next() * width);
  }

  normal(mean: number, standardDeviation: number): number {
    if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation) || standardDeviation < 0) {
      throw new Error("Normal distribution parameters must be finite and deviation non-negative.");
    }
    if (standardDeviation === 0) return mean;
    let first = this.next();
    const second = this.next();
    if (first === 0) first = Number.EPSILON;
    const standard = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
    return mean + standard * standardDeviation;
  }

  fork(label: string): DeterministicRandom {
    assertNonEmpty(label, "Random stream label");
    return new SeededRandom(`${this.seed}::${label}`);
  }
}

export class DeterministicVirtualClock implements VirtualClock {
  private current: number;
  private readonly maximum: number;

  constructor(initialInstant: string, maximumInstant: string) {
    this.current = parseInstant(initialInstant, "Virtual clock initial instant");
    this.maximum = parseInstant(maximumInstant, "Virtual clock maximum instant");
    if (this.maximum < this.current) throw new Error("Virtual clock maximum must not precede its initial instant.");
  }

  now(): Date {
    return new Date(this.current);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  advanceBy(milliseconds: number): string {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error("Virtual clock can advance only by a non-negative whole number of milliseconds.");
    }
    return this.advanceTo(new Date(this.current + milliseconds).toISOString());
  }

  advanceTo(instant: string): string {
    const next = parseInstant(instant, "Virtual clock target instant");
    if (next < this.current) throw new Error("Virtual clock cannot move backwards.");
    if (next > this.maximum) throw new Error("Virtual clock cannot advance beyond the scenario horizon.");
    this.current = next;
    return this.nowIso();
  }
}

export class SideEffectDeniedError extends Error {
  readonly code = "scenario_side_effect_denied";
  readonly request: ScenarioSideEffectRequest;

  constructor(request: ScenarioSideEffectRequest) {
    super(`Scenario runtime denied ${request.kind} for namespace ${request.target_namespace_id}.`);
    this.name = "SideEffectDeniedError";
    this.request = request;
  }
}

export class SinkOnlySideEffectPolicy implements ScenarioSideEffectPolicy {
  readonly mode = "sink_only" as const;
  private readonly namespaceId: string;

  constructor(namespaceId: string) {
    assertNonEmpty(namespaceId, "Scenario namespace");
    this.namespaceId = namespaceId;
  }

  permits(request: ScenarioSideEffectRequest): boolean {
    return request.target_namespace_id === this.namespaceId
      && (request.kind === "scenario_event"
        || request.kind === "scenario_message"
        || request.kind === "scenario_artifact");
  }

  assertPermitted(request: ScenarioSideEffectRequest): void {
    if (!this.permits(request)) throw new SideEffectDeniedError(request);
  }
}

class IsolatedScenarioIdentityResolver implements ScenarioIdentityResolver {
  private readonly counterparts = new Map<string, ScenarioCounterpartIdentity>();
  private readonly sources = new Map<string, ScenarioSourceAgentIdentity>();
  private readonly counterpartBySource = new Map<string, ScenarioCounterpartIdentity>();
  private readonly personas = new Map<string, ScenarioPersonaIdentity>();
  private readonly humans = new Map<string, HumanAgentIdentity>();
  private readonly personaByHuman = new Map<string, ScenarioPersonaIdentity>();
  private readonly delegates = new Map<string, DelegateAgentIdentity>();
  private readonly actorIds = new Set<string>();

  constructor(scenarioId: string, mappings: readonly ScenarioIdentityMapping[]) {
    for (const mapping of mappings) {
      const source = "source" in mapping ? mapping.source : mapping.human;
      const sourceAgentId = source.kind === "human" ? source.human_agent_id : source.agent_id;
      const counterpart: ScenarioCounterpartIdentity = "counterpart" in mapping
        ? mapping.counterpart
        : {
            kind: "scenario_counterpart",
            scenario_counterpart_id: mapping.persona.scenario_persona_id,
            scenario_id: mapping.persona.scenario_id,
            source_agent_id: mapping.persona.source_human_agent_id,
            source_agent_kind: "human",
            behaviour_policy_version_id: mapping.persona.behaviour_policy_version_id,
          };

      assertNonEmpty(sourceAgentId, "Source agent ID");
      if (source.kind === "human") {
        assertNonEmpty(source.person_id, "Human source person ID");
      } else {
        assertNonEmpty(source.external_ref, `${source.kind} source external reference`);
      }
      assertNonEmpty(counterpart.scenario_counterpart_id, "Scenario counterpart ID");
      if (counterpart.behaviour_policy_version_id !== null) {
        assertNonEmpty(counterpart.behaviour_policy_version_id, "Scenario counterpart behaviour version");
      }
      if (counterpart.scenario_id !== scenarioId) {
        throw new Error("Every scenario counterpart must belong to the active scenario.");
      }
      if (counterpart.source_agent_id !== sourceAgentId
        || counterpart.source_agent_kind !== source.kind) {
        throw new Error("A scenario counterpart must explicitly reference its source agent and kind.");
      }
      if (this.sources.has(sourceAgentId)
        || this.counterparts.has(counterpart.scenario_counterpart_id)) {
        throw new Error("Scenario identity mappings must be one-to-one.");
      }
      if (this.actorIds.has(sourceAgentId)
        || this.actorIds.has(counterpart.scenario_counterpart_id)
        || sourceAgentId === counterpart.scenario_counterpart_id) {
        throw new Error("Source, delegate and scenario-counterpart actor IDs must remain distinct.");
      }
      this.actorIds.add(sourceAgentId);
      this.actorIds.add(counterpart.scenario_counterpart_id);
      this.sources.set(sourceAgentId, structuredClone(source));
      this.counterparts.set(counterpart.scenario_counterpart_id, structuredClone(counterpart));
      this.counterpartBySource.set(sourceAgentId, structuredClone(counterpart));

      if (source.kind === "human") {
        const persona: ScenarioPersonaIdentity = "persona" in mapping
          ? mapping.persona
          : {
              kind: "scenario_persona",
              scenario_persona_id: counterpart.scenario_counterpart_id,
              scenario_id: counterpart.scenario_id,
              source_human_agent_id: source.human_agent_id,
              behaviour_policy_version_id: counterpart.behaviour_policy_version_id,
            };
        this.humans.set(source.human_agent_id, structuredClone(source));
        this.personas.set(persona.scenario_persona_id, structuredClone(persona));
        this.personaByHuman.set(source.human_agent_id, structuredClone(persona));
      } else if (mapping.delegates.length > 0) {
        throw new Error("Delegate identities may be attached only to a human source agent.");
      }

      for (const delegate of mapping.delegates) {
        if (source.kind !== "human" || delegate.acts_for_human_agent_id !== source.human_agent_id) {
          throw new Error("A delegate mapping must name the human agent it acts for.");
        }
        assertNonEmpty(delegate.delegate_agent_id, "Delegate agent ID");
        assertNonEmpty(delegate.authority_snapshot_ref, "Delegate authority snapshot reference");
        if (this.delegates.has(delegate.delegate_agent_id)) {
          throw new Error("A delegate agent may appear in only one scenario identity mapping.");
        }
        if (this.actorIds.has(delegate.delegate_agent_id)) {
          throw new Error("Source, delegate and scenario-counterpart actor IDs must remain distinct.");
        }
        this.actorIds.add(delegate.delegate_agent_id);
        this.delegates.set(delegate.delegate_agent_id, structuredClone(delegate));
      }
    }
  }

  resolveCounterpart(scenarioCounterpartId: string): ScenarioCounterpartIdentity | null {
    const result = this.counterparts.get(scenarioCounterpartId);
    return result ? structuredClone(result) : null;
  }

  counterpartForSource(sourceAgentId: string): ScenarioCounterpartIdentity | null {
    const result = this.counterpartBySource.get(sourceAgentId);
    return result ? structuredClone(result) : null;
  }

  sourceForCounterpart(scenarioCounterpartId: string): ScenarioSourceAgentIdentity | null {
    const counterpart = this.counterparts.get(scenarioCounterpartId);
    if (!counterpart) return null;
    const source = this.sources.get(counterpart.source_agent_id);
    return source ? structuredClone(source) : null;
  }

  resolvePersona(scenarioPersonaId: string): ScenarioPersonaIdentity | null {
    const result = this.personas.get(scenarioPersonaId);
    return result ? structuredClone(result) : null;
  }

  personaForHuman(humanAgentId: string): ScenarioPersonaIdentity | null {
    const result = this.personaByHuman.get(humanAgentId);
    return result ? structuredClone(result) : null;
  }

  humanForPersona(scenarioPersonaId: string): HumanAgentIdentity | null {
    const source = this.sourceForCounterpart(scenarioPersonaId);
    return source?.kind === "human" ? structuredClone(source) : null;
  }

  delegate(delegateAgentId: string): DelegateAgentIdentity | null {
    const result = this.delegates.get(delegateAgentId);
    return result ? structuredClone(result) : null;
  }
}

class SinkScenarioMessageDispatcher implements ScenarioMessageDispatcher {
  readonly mode = "sink_only" as const;
  private readonly dispatched: ScenarioMessage[] = [];

  constructor(
    private readonly namespaceId: string,
    private readonly runId: string,
    private readonly identities: ScenarioIdentityResolver,
    private readonly policy: ScenarioSideEffectPolicy,
  ) {}

  dispatch(message: ScenarioMessage): void {
    const senderId = "sender_counterpart_id" in message
      ? message.sender_counterpart_id
      : message.sender_persona_id;
    const recipientId = "recipient_counterpart_id" in message
      ? message.recipient_counterpart_id
      : message.recipient_persona_id;
    const sender = this.identities.resolveCounterpart(senderId);
    if (message.scenario_id !== sender?.scenario_id
      || message.namespace_id !== this.namespaceId
      || message.run_id !== this.runId) {
      throw new Error("Scenario messages must retain their scenario and namespace identity.");
    }
    this.policy.assertPermitted({
      kind: "scenario_message",
      target_namespace_id: this.namespaceId,
      target_ref: recipientId,
    });
    if (!sender || !this.identities.resolveCounterpart(recipientId)) {
      throw new Error("Scenario messages may address only counterparts in this scenario namespace.");
    }
    this.dispatched.push(structuredClone(message));
  }

  messages(): readonly ScenarioMessage[] {
    return structuredClone(this.dispatched);
  }
}

class TransientScenarioEvidenceStore implements ScenarioEvidenceStore {
  private readonly values = new Map<string, ScenarioValue>();

  put(key: string, value: ScenarioValue): void {
    assertNonEmpty(key, "Scenario evidence key");
    this.values.set(key, cloneScenarioValue(value));
  }

  get(key: string): ScenarioValue | null {
    const result = this.values.get(key);
    return result === undefined ? null : cloneScenarioValue(result);
  }

  entries(): Readonly<Record<string, ScenarioValue>> {
    return Object.freeze(Object.fromEntries(
      [...this.values.entries()].map(([key, value]) => [key, cloneScenarioValue(value)]),
    ));
  }
}

export interface CreateScenarioExecutionContextInput {
  mode: ScenarioExecutionMode;
  namespace_id: string;
  institution_id: string;
  scenario_id: string;
  run_id: string;
  deterministic_seed: string;
  horizon: { from: string; to: string };
  configuration_snapshot: readonly ScenarioConfigurationRef[];
  identities: readonly ScenarioIdentityMapping[];
}

export function createScenarioExecutionContext(
  input: CreateScenarioExecutionContextInput,
): ScenarioExecutionContext {
  for (const [label, value] of Object.entries({
    namespace_id: input.namespace_id,
    institution_id: input.institution_id,
    scenario_id: input.scenario_id,
    run_id: input.run_id,
    deterministic_seed: input.deterministic_seed,
  })) assertNonEmpty(value, label);
  if (input.namespace_id === input.institution_id) {
    throw new Error("Scenario namespace must be isolated from the production institution namespace.");
  }
  const identityResolver = new IsolatedScenarioIdentityResolver(input.scenario_id, input.identities);
  const policy = new SinkOnlySideEffectPolicy(input.namespace_id);
  const configurationSnapshot = Object.freeze(
    structuredClone(input.configuration_snapshot).map((configuration) => Object.freeze(configuration)),
  );
  const context: ScenarioExecutionContext = {
    mode: input.mode,
    namespace_id: input.namespace_id,
    institution_id: input.institution_id,
    scenario_id: input.scenario_id,
    run_id: input.run_id,
    deterministic_seed: input.deterministic_seed,
    clock: new DeterministicVirtualClock(input.horizon.from, input.horizon.to),
    random: new SeededRandom(input.deterministic_seed),
    identity_resolver: identityResolver,
    configuration_snapshot: configurationSnapshot,
    message_dispatcher: new SinkScenarioMessageDispatcher(input.namespace_id, input.run_id, identityResolver, policy),
    evidence_store: new TransientScenarioEvidenceStore(),
    side_effect_policy: policy,
  };
  return Object.freeze(context);
}
