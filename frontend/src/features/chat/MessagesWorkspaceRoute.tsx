import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import type { WorkspaceArea, WorkspaceAreaSurface } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceState } from "../workspace/WorkspaceState";
import {
  RelationshipSubjectPicker,
  relationshipSurfaceOptions,
  relationshipTarget,
  resolveRelationshipSelection,
} from "../workspace/RelationshipSurfaceResolver";
import { ChatExperience, type ChatWorkspaceContext } from "./ChatPage";

interface MessageContextOption {
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
  readonly surface: WorkspaceAreaSurface;
  readonly context: ChatWorkspaceContext;
}

function relationshipSurface(surface: WorkspaceAreaSurface) {
  const match = surface.key.match(/^conversations:(self|dependent):(.+)$/);
  if (!match) return null;
  return { kind: match[1] as "self" | "dependent", studentId: match[2] };
}

export function messageContextOptions(area: WorkspaceArea): MessageContextOption[] {
  return area.surfaces.flatMap<MessageContextOption>((surface): MessageContextOption[] => {
    if (surface.key === "conversations") {
      return [{
        key: surface.key,
        label: surface.label || "Campus conversations",
        description: surface.description,
        surface,
        context: {
          kind: "responsibility" as const,
          label: surface.label || "Campus conversations",
          canCreateGroups: surface.capabilities.includes("groups.create"),
        },
      }];
    }
    const relationship = relationshipSurface(surface);
    if (!relationship) return [];
    return [{
      key: surface.key,
      label: surface.label,
      description: surface.description,
      surface,
      context: {
        kind: relationship.kind,
        label: surface.label,
        studentId: relationship.studentId,
        canCreateGroups: false,
      },
    }];
  });
}

function MessageContextBar({
  options,
  selected,
  onChange,
}: {
  readonly options: readonly MessageContextOption[];
  readonly selected: MessageContextOption;
  readonly onChange: (key: string) => void;
}) {
  return <section className="messages-workspace-context" aria-label="Conversation scope">
    <span className="messages-workspace-context__copy">
      <small>Conversation scope</small>
      <strong>{selected.label}</strong>
      {selected.description ? <span>{selected.description}</span> : null}
    </span>
    {options.length > 1 ? <label>
      <span className="sr-only">Choose conversation scope</span>
      <select value={selected.key} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </label> : null}
  </section>;
}

/**
 * Canonical responsibility-composed Messages workspace. The workspace
 * manifest decides which scopes are discoverable; the Chat domain still
 * authorizes every conversation, participant and mutation.
 */
export function MessagesWorkspaceRoute() {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  if (params.get("moderation") === "reports") {
    return <Navigate to="/areas/safeguarding" replace />;
  }
  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <OperationsShell active="areas" title="Messages"><WorkspaceState state="unavailable" /></OperationsShell>;
  }
  if (query.isPending) {
    return <OperationsShell active="areas" title="Messages"><WorkspaceState state="loading" /></OperationsShell>;
  }
  if (query.error) {
    const state = query.error instanceof ApiError && query.error.status === 403 ? "revoked" : "error";
    return <OperationsShell active="areas" title="Messages"><WorkspaceState state={state} error={query.error} onRetry={query.refetch} /></OperationsShell>;
  }
  const area = query.data?.areas.find((entry) => entry.key === "messages");
  const options = area ? messageContextOptions(area) : [];
  const hasRelationshipContext = params.has("scope") || params.has("student_id");
  const operational = options.find((option) => option.key === "conversations");
  const relationshipOptions = relationshipSurfaceOptions(area, "conversations");
  const relationshipResolution = hasRelationshipContext || !operational
    ? resolveRelationshipSelection(relationshipOptions, params)
    : null;
  const active = relationshipResolution?.state === "selected"
    ? options.find((option) => option.key === relationshipResolution.option.key)
    : !hasRelationshipContext
      ? operational
      : undefined;

  if (!query.data || !manifestMatchesEnvironment(query.data, environment) || !area) {
    return <OperationsShell active="areas" title={area?.label ?? "Messages"}>
      <WorkspaceState state="revoked" onRetry={query.refetch} />
    </OperationsShell>;
  }
  if (relationshipResolution?.state === "choose") {
    return <OperationsShell active="areas" title="Messages" subtitle="Secure campus communication">
      <RelationshipSubjectPicker title="Choose a learner for messages" options={relationshipResolution.options} />
    </OperationsShell>;
  }
  if (relationshipResolution?.state === "selected" && relationshipResolution.canonicalize) {
    return <Navigate replace to={relationshipTarget(location, relationshipResolution.option)} />;
  }
  if (!active) {
    return <OperationsShell active="areas" title={area.label}>
      <WorkspaceState state="revoked" onRetry={query.refetch} />
    </OperationsShell>;
  }

  const changeContext = (key: string) => {
    const option = options.find((candidate) => candidate.key === key);
    if (!option) return;
    const next = new URLSearchParams(params);
    next.delete("conversation");
    next.delete("scope");
    next.delete("student_id");
    if (option.context.kind !== "responsibility" && option.context.studentId) {
      next.set("scope", option.context.kind);
      next.set("student_id", option.context.studentId);
    }
    setParams(next);
  };

  return <OperationsShell active="areas" title="Messages" subtitle="Secure campus communication">
    <div className="messages-workspace">
      <MessageContextBar options={options} selected={active} onChange={changeContext} />
      <ChatExperience context={active.context} />
    </div>
  </OperationsShell>;
}
