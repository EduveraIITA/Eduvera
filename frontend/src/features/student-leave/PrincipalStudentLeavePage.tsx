import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getLeaveRequest, getSchoolLeaveRequests, performLeaveAction } from "../school/api";
import { PrincipalStudentLeaveView, type SchoolLeaveDecision } from "./PrincipalStudentLeaveView";
import "./principal-student-leave.css";

const queueKey = ["school", "principal", "student-leave", "queue"] as const;

export default function PrincipalStudentLeavePage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const requestedId = params.get("request")?.trim() || undefined;
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const membership = auth.memberships.find((item) => item.role === "admin");

  const queueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => getSchoolLeaveRequests("authorized"),
    staleTime: 15_000,
    refetchOnMount: "always",
  });
  const selectedId = requestedId;
  const detailQuery = useQuery({
    queryKey: ["school", "principal", "student-leave", "request", selectedId ?? "none"],
    queryFn: () => getLeaveRequest(selectedId!),
    enabled: Boolean(selectedId),
    staleTime: 10_000,
  });
  const exactRequestUnavailable = Boolean(
    requestedId
    && detailQuery.error instanceof ApiError
    && detailQuery.error.status === 404,
  );

  const decide = async (decision: SchoolLeaveDecision, note: string) => {
    if (!detailQuery.data) return;
    setBusy(true);
    setDecisionError("");
    try {
      await performLeaveAction(detailQuery.data.id, decision, note);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queueKey }),
        queryClient.invalidateQueries({ queryKey: ["requests", "principal"] }),
        queryClient.invalidateQueries({ queryKey: ["attention", "principal"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        detailQuery.refetch(),
      ]);
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "The decision could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  let content;
  if (!requestedId && queueQuery.isPending) {
    content = <ScreenLoading />;
  } else if (!requestedId && queueQuery.isError) {
    content = <LiveRouteError error={queueQuery.error} onRetry={queueQuery.refetch} />;
  } else if (selectedId && detailQuery.isPending) {
    content = <ScreenLoading />;
  } else if (selectedId && detailQuery.isError && !exactRequestUnavailable) {
    content = <LiveRouteError error={detailQuery.error} onRetry={detailQuery.refetch} />;
  } else {
    content = <PrincipalStudentLeaveView
      queue={queueQuery.data?.results ?? []}
      selected={detailQuery.data ?? null}
      requestedId={requestedId}
      busy={busy}
      error={decisionError}
      queuePending={queueQuery.isPending}
      queueUnavailable={queueQuery.isError}
      onDecide={decide}
    />;
  }

  return (
    <OperationsShell
      portal="principal"
      active="more"
      title={requestedId ? "Leave request" : "Student leave"}
      schoolName={membership?.school_name}
      backTo={requestedId ? "/principal/student-leave" : "/principal/requests"}
    >
      {content}
    </OperationsShell>
  );
}
