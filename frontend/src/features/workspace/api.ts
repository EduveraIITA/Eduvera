import { apiFetch } from "../../lib/api";
import { normalizeWorkspaceManifest } from "../../../../packages/contracts/src/workspace-normalizer";

export { normalizeWorkspaceManifest, WorkspaceManifestError } from "../../../../packages/contracts/src/workspace-normalizer";

export async function getWorkspaceManifest(signal?: AbortSignal) {
  const response = await apiFetch<unknown>("/api/v1/workspace", { signal });
  return normalizeWorkspaceManifest(response);
}
