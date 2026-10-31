import { useQuery } from "@tanstack/react-query";
import { executionEnvironmentIdentity } from "../simulation/executionEnvironment";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { getWorkspaceManifest } from "./api";
import { useOptionalAuth } from "../auth/AuthContext";

export const workspaceQueryRoot = ["responsibility-workspace"] as const;

export function workspaceQueryKey(environmentIdentity: string, actorId?: string, schoolId?: string | null) {
  return [...workspaceQueryRoot, environmentIdentity, "actor", actorId ?? "session", "campus", schoolId ?? "selected"] as const;
}

/**
 * The active execution environment is part of the cache identity. The global
 * environment boundary also clears queries during a confirmed switch, so a
 * Live manifest cannot remain visible beneath a Simulation marker (or vice
 * versa).
 */
export function useWorkspaceManifest(enabled = true) {
  const environment = useExecutionEnvironment();
  const auth = useOptionalAuth();
  const environmentIdentity = executionEnvironmentIdentity(environment);

  return useQuery({
    queryKey: workspaceQueryKey(environmentIdentity, auth?.user?.id, auth?.user?.active_school_id ?? environment.institutionId ?? auth?.memberships[0]?.school_id),
    queryFn: ({ signal }) => getWorkspaceManifest(signal),
    enabled: enabled && !(environment.mode === "simulation" && environment.unavailable === true),
    staleTime: 15_000,
    refetchInterval: 60_000,
    // The shell and domain eligibility boundaries share this projection. A
    // fresh manifest remains valid across their sequential mounts; forcing a
    // read on every mount needlessly fans out selected-world database work.
    refetchOnMount: true,
    // Surface a failed initial read with the existing explicit Refresh action
    // instead of holding the whole app in its loading state during retries.
    retry: false,
  });
}
