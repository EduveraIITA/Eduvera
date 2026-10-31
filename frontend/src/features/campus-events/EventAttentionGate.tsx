import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import type { CampusEventDto } from "./types";

export interface OperationsEventAttentionTarget {
  notificationId: string | null;
  focus: string | null;
  eventRevision: number | null;
}

export function operationsEventAttentionResolution(
  event: Pick<CampusEventDto, "status" | "revision">,
  target: OperationsEventAttentionTarget,
): "none" | "exact" | "stale" {
  if (!target.notificationId) return "none";
  if (target.focus !== "status" || !target.eventRevision) return "stale";
  return event.status === "cancelled" && event.revision === target.eventRevision ? "exact" : "stale";
}

export function OperationsEventAttentionGate({
  event,
  target,
}: {
  event: Pick<CampusEventDto, "status" | "revision">;
  target: OperationsEventAttentionTarget;
}) {
  const resolution = operationsEventAttentionResolution(event, target);
  if (resolution === "exact") return <AttentionOpenAcknowledgement />;
  if (resolution === "stale") {
    return <AttentionTargetUnavailable message="This event cancellation no longer matches the current record. It was not marked as opened." />;
  }
  return null;
}
