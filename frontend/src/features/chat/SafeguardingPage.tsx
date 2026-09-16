/* eslint-disable */
// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import {
  getChatReportReviewers,
  getChatReports,
  updateChatReport,
  type ChatReportUpdate,
} from "./api";
import { ModerationDialog } from "./ModerationDialog";
import "./chat.css";

type StaffPortal = "teacher" | "principal";

function SafeguardingRoute({ portal }: { portal: StaffPortal }) {
  const queryClient = useQueryClient();
  const reportsQuery = useQuery({
    queryKey: ["chat", "reports"],
    queryFn: () => getChatReports(),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  const reviewersQuery = useQuery({
    queryKey: ["chat", "report-reviewers"],
    queryFn: getChatReportReviewers,
    enabled: portal === "principal",
    staleTime: 60_000,
  });
  const moderationMutation = useMutation({
    mutationFn: ({ reportId, input }: { reportId: string; input: ChatReportUpdate }) => updateChatReport(reportId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat", "reports"] }),
        queryClient.invalidateQueries({ queryKey: ["chat", "messages"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });

  return (
    <OperationsShell
      portal={portal}
      active="safeguarding"
      title="Safeguarding"
      subtitle={portal === "teacher" ? "Your assigned incident reviews" : "Confidential pastoral operations"}
    >
      <ModerationDialog
        standalone
        staffView={portal === "teacher"}
        queue={reportsQuery.data}
        reviewers={reviewersQuery.data?.results ?? []}
        loading={reportsQuery.isPending}
        pending={moderationMutation.isPending}
        error={moderationMutation.isError ? moderationMutation.error.message : undefined}
        loadError={reportsQuery.isError ? reportsQuery.error.message : undefined}
        onRefresh={() => void reportsQuery.refetch()}
        onUpdate={(reportId, input) => moderationMutation.mutate({ reportId, input })}
      />
    </OperationsShell>
  );
}

export function TeacherSafeguardingRoute() {
  return <SafeguardingRoute portal="teacher" />;
}

export function PrincipalSafeguardingRoute() {
  return <SafeguardingRoute portal="principal" />;
}
