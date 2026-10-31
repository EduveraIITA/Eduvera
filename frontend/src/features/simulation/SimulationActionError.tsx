import { ApiError } from "../../lib/api";

export function simulationCapacityResource(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 429 || !error.details || typeof error.details !== "object") return null;
  const body = error.details as Record<string, unknown>;
  const details = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : body;
  return details.code === "simulation_institution_capacity" && typeof details.resource === "string" ? details.resource : null;
}

export function SimulationActionError({ error, onManage }: { error: unknown; onManage: (saved: boolean) => void }) {
  if (!error) return null;
  const resource = simulationCapacityResource(error);
  return <div className="simulation-workspace__error" role="alert">
    <p>{error instanceof Error && error.message ? error.message : "The simulation could not be prepared. Live is unchanged."}</p>
    {resource ? <button type="button" className="simulation-text-button" onClick={() => onManage(true)}>Manage saved simulations</button> : null}
  </div>;
}
