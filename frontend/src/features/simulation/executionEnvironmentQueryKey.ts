import {
  ExecutionEnvironmentInvariantError,
  normalizeExecutionEnvironment,
  type ExecutionEnvironment,
} from "./executionEnvironment";

export type ApplicationQueryKey = readonly unknown[];

export type LiveEnvironmentQueryKey<TKey extends ApplicationQueryKey> = readonly [
  "execution-environment",
  "live",
  ...TKey,
];

export type SimulationEnvironmentQueryKey<TKey extends ApplicationQueryKey> = readonly [
  "execution-environment",
  "simulation",
  string,
  string,
  ...TKey,
];

export type EnvironmentQueryKey<TKey extends ApplicationQueryKey> =
  | LiveEnvironmentQueryKey<TKey>
  | SimulationEnvironmentQueryKey<TKey>;

/**
 * Prefixes every server-state key with its execution environment. Simulation keys
 * also include namespace and run identity, preventing one run from reading live or
 * another run's cached data even when their domain keys are otherwise identical.
 */
export function executionEnvironmentQueryKey<
  const TKey extends ApplicationQueryKey,
>(
  environment: ExecutionEnvironment,
  queryKey: TKey,
): EnvironmentQueryKey<TKey> {
  const normalizedEnvironment = normalizeExecutionEnvironment(environment);

  if (normalizedEnvironment.mode === "live") {
    return ["execution-environment", "live", ...queryKey];
  }

  if (normalizedEnvironment.unavailable === true) {
    throw new ExecutionEnvironmentInvariantError(
      "Unavailable simulations cannot create application query keys.",
    );
  }

  return [
    "execution-environment",
    "simulation",
    normalizedEnvironment.namespaceId,
    normalizedEnvironment.runId,
    ...queryKey,
  ];
}
