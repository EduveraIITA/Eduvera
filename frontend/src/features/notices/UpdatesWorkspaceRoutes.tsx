import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import type { WorkspaceArea, WorkspaceAreaSurface } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { NoticeComposerPage } from "./NoticeComposerPage";
import { NoticeDetailPage } from "./NoticeDetailPage";
import { NoticeListPage } from "./NoticeListPage";
import type { NoticeWorkspaceContext } from "./noticeWorkspaceContext";
import "./notices.css";

export interface UpdateContextOption {
  readonly key: string;
  readonly context: NoticeWorkspaceContext;
}

function updateRelationship(surface: WorkspaceAreaSurface) {
  const match = surface.key.match(/^updates:(dependent):(.+)$/);
  return match ? { scope: match[1] as "dependent", studentId: match[2]! } : null;
}

export function updateContextOptions(area: WorkspaceArea, institutionId: string): UpdateContextOption[] {
  const options: UpdateContextOption[] = [];
  area.surfaces.forEach((surface) => {
    if (surface.key === "updates") {
      options.push({
        key: surface.key,
        context: {
          scope: "responsibility" as const,
          schoolId: institutionId,
          label: surface.label || "Campus updates",
          description: surface.description,
          capabilities: surface.capabilities,
        },
      });
      return;
    }
    const relationship = updateRelationship(surface);
    if (!relationship) return;
    options.push({
      key: surface.key,
      context: {
        scope: relationship.scope,
        schoolId: institutionId,
        studentId: relationship.studentId,
        label: surface.label,
        description: surface.description,
        capabilities: surface.capabilities,
      },
    });
  });
  return options;
}

function requestedUpdateKey(params: URLSearchParams) {
  const scope = params.get("scope");
  const studentId = params.get("student_id");
  if (scope === "dependent" && studentId) return `updates:dependent:${studentId}`;
  if (scope || studentId) return null;
  return "updates";
}

function shellState(
  title: string,
  query: ReturnType<typeof useWorkspaceManifest>,
  state: "unavailable" | "loading" | "revoked" | "error",
) {
  return <OperationsShell active="areas" title={title} backTo="/areas/messages">
    <WorkspaceState state={state} error={query.error ?? undefined} onRetry={query.refetch} />
  </OperationsShell>;
}

function useUpdateContext(requireCompose = false) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  const [params, setParams] = useSearchParams();
  if (environment.mode === "simulation" && environment.unavailable === true) {
    return { view: shellState("Updates", query, "unavailable") } as const;
  }
  if (query.isPending) return { view: shellState("Updates", query, "loading") } as const;
  if (query.error) {
    const state = query.error instanceof ApiError && query.error.status === 403 ? "revoked" : "error";
    return { view: shellState("Updates", query, state) } as const;
  }
  const manifest = query.data;
  const area = manifest?.areas.find((entry) => entry.key === "messages");
  const options = area && manifest ? updateContextOptions(area, manifest.context.institution_id) : [];
  const requestedKey = requestedUpdateKey(params);
  const malformed = params.has("scope") || params.has("student_id");
  const selected = requestedKey ? options.find((option) => option.key === requestedKey) : undefined;
  const active = selected ?? (!malformed ? options[0] : undefined);
  if (!manifest || !manifestMatchesEnvironment(manifest, environment) || !active
    || (requireCompose && (active.context.scope !== "responsibility" || !active.context.capabilities.includes("messages.send")))) {
    return { view: shellState("Updates", query, "revoked") } as const;
  }
  const select = (key: string) => {
    const option = options.find((candidate) => candidate.key === key);
    if (!option) return;
    const next = new URLSearchParams(params);
    next.delete("scope");
    next.delete("student_id");
    next.delete("focus");
    if (option.context.scope === "dependent" && option.context.studentId) {
      next.set("scope", "dependent");
      next.set("student_id", option.context.studentId);
    }
    setParams(next);
  };
  return { context: active.context, options, select } as const;
}

export function WorkspaceUpdatesRoute() {
  const resolved = useUpdateContext();
  if ("view" in resolved) return resolved.view;
  return <NoticeListPage
    workspace={resolved.context}
    workspaceOptions={resolved.options.map((option) => ({ key: option.key, ...option.context }))}
    onWorkspaceChange={resolved.select}
  />;
}

export function WorkspaceUpdateDetailRoute() {
  const { noticeId } = useParams();
  const resolved = useUpdateContext();
  if ("view" in resolved) return resolved.view;
  return noticeId
    ? <NoticeDetailPage workspace={resolved.context} noticeId={noticeId} />
    : <Navigate to="/areas/messages/updates" replace />;
}

export function WorkspaceUpdateCreateRoute() {
  const resolved = useUpdateContext(true);
  if ("view" in resolved) return resolved.view;
  return <NoticeComposerPage workspace={resolved.context} />;
}

export function WorkspaceUpdateEditRoute() {
  const { noticeId } = useParams();
  const resolved = useUpdateContext(true);
  if ("view" in resolved) return resolved.view;
  return noticeId
    ? <NoticeComposerPage workspace={resolved.context} noticeId={noticeId} />
    : <Navigate to="/areas/messages/updates" replace />;
}
