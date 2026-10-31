import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import {
  getChatReport,
  getChatReportReviewers,
  getChatReports,
  updateChatReport,
  type ChatReportUpdate,
} from "../chat/api";
import { ModerationDialog } from "../chat/ModerationDialog";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { ProtectedCareWorkspace } from "./RestrictedCarePage";

function mayReviewMessageReports(capabilities: readonly string[]) {
  return capabilities.some((capability) => capability === "safeguarding.review" || capability === "safeguarding.manage");
}

/** A redundant Area landing never becomes another Student care screen. */
export function WorkspaceCareHomeRoute() {
  return <Navigate replace to="/areas/care/concerns" />;
}

/**
 * Canonical protected-care route. Institution and message-moderation scope are
 * read from the current workspace contribution; the care domain independently
 * rechecks case, intake, team and action authority.
 */
export function WorkspaceCareRoute() {
  const environment = useExecutionEnvironment();
  const manifestQuery = useWorkspaceManifest();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const manifest = manifestQuery.data;
  const careArea = manifest?.areas.find((area) => area.key === "care");
  const concernSurface = careArea?.surfaces.find((surface) => surface.key === "concerns");
  const canReviewReports = mayReviewMessageReports(concernSurface?.capabilities ?? []);
  const reportId = canReviewReports && params.get("section") === "message_reports" ? params.get("report") : null;

  const reportsQuery = useQuery({
    queryKey: ["chat", "reports", manifest?.context.institution_id],
    queryFn: () => getChatReports(),
    enabled: Boolean(manifest && concernSurface && canReviewReports),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  const reportQuery = useQuery({
    queryKey: ["chat", "reports", "detail", reportId],
    queryFn: () => getChatReport(reportId!),
    enabled: Boolean(reportId),
    retry: false,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  const canAssign = canReviewReports && (reportQuery.data?.can_assign === true
    || reportsQuery.data?.results.some((report) => report.can_assign) === true);
  const reviewersQuery = useQuery({
    queryKey: ["chat", "report-reviewers", manifest?.context.institution_id],
    queryFn: getChatReportReviewers,
    enabled: canAssign,
    staleTime: 60_000,
  });
  const moderationMutation = useMutation({
    mutationFn: ({ reportId: selectedReportId, input }: { reportId: string; input: ChatReportUpdate }) => updateChatReport(selectedReportId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat", "reports"] }),
        queryClient.invalidateQueries({ queryKey: ["chat", "messages"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });

  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <OperationsShell active="areas" title="Student care"><WorkspaceState state="unavailable" /></OperationsShell>;
  }
  if (manifestQuery.isPending) {
    return <OperationsShell active="areas" title="Student care"><WorkspaceState state="loading" /></OperationsShell>;
  }
  if (manifestQuery.error) {
    const revoked = manifestQuery.error instanceof ApiError && manifestQuery.error.status === 403;
    return <OperationsShell active="areas" title="Student care"><WorkspaceState state={revoked ? "revoked" : "error"} error={manifestQuery.error} onRetry={manifestQuery.refetch} /></OperationsShell>;
  }
  if (!manifest || !manifestMatchesEnvironment(manifest, environment) || !concernSurface) {
    return <OperationsShell active="areas" title="Student care" backTo="/areas"><WorkspaceState state="revoked" onRetry={manifestQuery.refetch} /></OperationsShell>;
  }

  const messageReports = canReviewReports ? <ModerationDialog
    standalone
    staffView={!canAssign}
    queue={reportsQuery.data}
    reviewers={reviewersQuery.data?.results ?? []}
    loading={reportsQuery.isPending}
    pending={moderationMutation.isPending}
    error={moderationMutation.isError ? moderationMutation.error.message : undefined}
    loadError={reportsQuery.isError ? reportsQuery.error.message : undefined}
    onRefresh={() => void reportsQuery.refetch()}
    selectedReport={reportQuery.data}
    selectedLoading={Boolean(reportId) && reportQuery.isPending}
    selectedLoadError={Boolean(reportId) && reportQuery.isError}
    onRefreshSelected={() => void reportQuery.refetch()}
    onUpdate={(selectedReportId, input) => moderationMutation.mutate({ reportId: selectedReportId, input })}
  /> : undefined;

  return <ProtectedCareWorkspace
    schoolId={manifest.context.institution_id}
    schoolName={manifest.context.institution_label ?? undefined}
    {...(messageReports ? { messageReports } : {})}
  />;
}
