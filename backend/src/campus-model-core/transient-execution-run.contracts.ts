/**
 * Server-owned catalogue of transient runs that may be selected by an
 * authenticated session. Implementations remain responsible for tenant and actor
 * authorization; the run ID alone never grants access.
 */
export const TRANSIENT_EXECUTION_RUN_CATALOG = Symbol.for(
  "thatcampus.transient-execution-run-catalog",
);

export interface TransientExecutionRunReference {
  readonly institution_id: string;
  readonly scenario_id: string;
  readonly run_id: string;
  readonly namespace_id: `scenario:${string}:run:${string}`;
  readonly virtual_now: string;
  readonly time_zone: string;
  readonly source_snapshot_at: string;
  readonly source_snapshot_ref: string;
  readonly expires_at: string;
}

export interface TransientExecutionRunCatalog {
  resolveAuthorizedRun(input: {
    actor_id: string;
    institution_id: string;
    run_id: string;
  }): Promise<TransientExecutionRunReference | null>;
}
