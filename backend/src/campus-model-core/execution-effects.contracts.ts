import type {
  LiveExecutionEnvironment,
  SimulationExecutionEnvironment,
} from "./execution-environment.contracts.js";

/**
 * Reviewed categories of work that can leave an execution environment. Adding a
 * category is a safety-contract change: every Simulation run must then provide a
 * run-scoped sink for it before effect coverage can pass.
 */
export const EXECUTION_EFFECT_KINDS = Object.freeze([
  "operational_message",
  "external_notification",
  "connector_call",
  "file_write",
  "external_compute_call",
  "webhook_delivery",
  "realtime_publication",
] as const);

export type ExecutionEffectKind = (typeof EXECUTION_EFFECT_KINDS)[number];

export type ExecutionEffectValue =
  | null
  | boolean
  | number
  | string
  | readonly ExecutionEffectValue[]
  | { readonly [key: string]: ExecutionEffectValue };

export type ExecutionEffectPrivacyClass =
  | "public"
  | "institution_internal"
  | "restricted_reference_only";

/**
 * This is a domain/logical target, never a provider address, credential, token,
 * filesystem path or URL. Only a Live production adapter may resolve it to a
 * concrete external endpoint. Simulation sinks retain this unresolved reference.
 */
export interface ExecutionEffectLogicalTarget {
  readonly kind: string;
  readonly ref: string;
}

/**
 * Provider-neutral request for an external/material effect. The payload must use a
 * reviewed schema owned by the caller; the core boundary validates the envelope
 * and environment but does not interpret domain meaning.
 */
export interface ExecutionEffectIntent<
  TKind extends ExecutionEffectKind = ExecutionEffectKind,
  TPayload extends ExecutionEffectValue = ExecutionEffectValue,
> {
  readonly kind: TKind;
  readonly effect_id: string;
  readonly schema_name: string;
  readonly schema_version: number;
  readonly institution_id: string;
  readonly namespace_id: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly requested_at: string;
  readonly actor_agent_id: string;
  readonly logical_target: ExecutionEffectLogicalTarget;
  readonly privacy_class: ExecutionEffectPrivacyClass;
  readonly payload: TPayload;
}

export interface LiveExecutionEffectReceipt<TKind extends ExecutionEffectKind = ExecutionEffectKind> {
  readonly environment_kind: "live";
  readonly effect_kind: TKind;
  readonly effect_id: string;
  readonly idempotency_key: string;
  readonly namespace_id: LiveExecutionEnvironment["namespace_id"];
  readonly port_id: string;
  readonly status: "accepted" | "deduplicated";
  readonly recorded_at: string;
  /** Provider-safe receipt reference; never a credential or response payload. */
  readonly provider_receipt_ref: string | null;
}

export interface SimulationExecutionEffectReceipt<
  TKind extends ExecutionEffectKind = ExecutionEffectKind,
> {
  readonly environment_kind: "simulation";
  readonly effect_kind: TKind;
  readonly effect_id: string;
  readonly idempotency_key: string;
  readonly namespace_id: SimulationExecutionEnvironment["namespace_id"];
  readonly scenario_id: string;
  readonly run_id: string;
  readonly sink_id: string;
  readonly sink_record_id: string;
  readonly status: "captured" | "deduplicated";
  readonly recorded_at: string;
}

export type ExecutionEffectReceipt<TKind extends ExecutionEffectKind = ExecutionEffectKind> =
  | LiveExecutionEffectReceipt<TKind>
  | SimulationExecutionEffectReceipt<TKind>;

export interface ProductionExecutionEffectPort<
  TKind extends ExecutionEffectKind = ExecutionEffectKind,
> {
  readonly mode: "production";
  readonly kind: TKind;
  readonly port_id: string;
  execute(input: {
    readonly environment: LiveExecutionEnvironment;
    readonly intent: ExecutionEffectIntent<TKind>;
  }): Promise<LiveExecutionEffectReceipt<TKind>>;
}

export interface SimulationExecutionEffectSink<
  TKind extends ExecutionEffectKind = ExecutionEffectKind,
> {
  readonly mode: "sink_only";
  readonly kind: TKind;
  readonly sink_id: string;
  readonly namespace_id: SimulationExecutionEnvironment["namespace_id"];
  readonly scenario_id: string;
  readonly run_id: string;
  capture(input: {
    readonly environment: SimulationExecutionEnvironment;
    readonly intent: ExecutionEffectIntent<TKind>;
  }): Promise<SimulationExecutionEffectReceipt<TKind>>;
}

export interface CapturedSimulationExecutionEffect<
  TKind extends ExecutionEffectKind = ExecutionEffectKind,
> {
  readonly intent: ExecutionEffectIntent<TKind>;
  readonly receipt: SimulationExecutionEffectReceipt<TKind>;
  readonly payload_digest: string;
}

export interface ExecutionEffectCoverage {
  readonly environment_kind: "live" | "simulation";
  readonly namespace_id: string;
  readonly status: "ready" | "blocked";
  readonly required_kinds: readonly ExecutionEffectKind[];
  readonly configured_kinds: readonly ExecutionEffectKind[];
  readonly missing_kinds: readonly ExecutionEffectKind[];
  readonly production_ports_reachable: boolean;
}
