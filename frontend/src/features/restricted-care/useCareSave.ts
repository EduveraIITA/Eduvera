import { useEffect, useRef, useState } from "react";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../lib/api";
import { executionRequestIdentity } from "../../lib/executionRequestScope";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { confirmCareCommand, type CareReceipt } from "./api";

type Pending = { commandId: string; caseId: string; slot: string; phase: "pending" | "unknown" | "accepted"; everUncertain: boolean; result?: CareReceipt };
type Operation = (commandId: string) => Promise<CareReceipt>;
function exactRefusal(error: unknown, value: Pending) {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const details = error.details as { error?: { code?: string; fields?: { care_command_refused?: Record<string, unknown> } } };
  const proof = details?.error?.fields?.care_command_refused;
  return details?.error?.code === "care_command_refused" && proof?.confirmation === "not_accepted" && proof.receipt_state === "absent"
    && proof.command_id === value.commandId && proof.case_id === value.caseId && ["stream_advanced", "route_unavailable", "recovery_not_applicable", "case_closed", "target_ineligible", "reporting_incomplete"].includes(String(proof.reason));
}
// Private drafts live only in the active session's memory, never storage or a
// recovery query payload. A scope change drops callable private closures.
const operations = new WeakMap<QueryClient, { scope: string; values: Map<string, Operation> }>();
export const careRecoveryKey = (scope: readonly unknown[]) => [...scope, "command-recovery"];

export function useCareRecovery(scope: readonly unknown[]) {
  const client = useQueryClient(), key = careRecoveryKey(scope), scopeId = JSON.stringify(scope);
  const query = useQuery<Pending[]>({ queryKey: key, queryFn: () => Promise.resolve([]), enabled: false, initialData: [], gcTime: Infinity });
  useEffect(() => {
    if (operations.get(client)?.scope !== scopeId) operations.set(client, { scope: scopeId, values: new Map() });
  }, [client, scopeId]);
  return { pending: query.data, set: (entry: Pending) => client.setQueryData<Pending[]>(key, previous => [...(previous ?? []).filter(item => item.slot !== entry.slot), entry]),
    clear: (commandId: string) => {
      if (operations.get(client)?.scope === scopeId) operations.get(client)?.values.delete(commandId);
      client.setQueryData<Pending[]>(key, previous => (previous ?? []).filter(item => item.commandId !== commandId));
    } };
}

/** One exact protected intent survives navigation and uncertain response loss.
 * Only opaque receipt references enter the query cache. No automatic resend. */
export function useCareSave({ schoolId, scope, slot, caseId, onAccepted }: {
  schoolId: string; scope: readonly unknown[]; slot: string; caseId?: string;
  onAccepted: (result: CareReceipt) => Promise<void> | void;
}) {
  const client = useQueryClient(), recovery = useCareRecovery(scope), scopeId = JSON.stringify(scope);
  const entry = recovery.pending.find(item => item.slot === slot), entryRef = useRef(entry);
  useEffect(() => { entryRef.current = entry; }, [entry]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [retryReady, setRetryReady] = useState(false), [reviewNeeded, setReviewNeeded] = useState(false);
  const active = useRef(true), pending = useRef(false), epoch = useRef(executionRequestIdentity());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const current = () => active.current && epoch.current === executionRequestIdentity();
  useUnsavedChangesGuard(busy || Boolean(entry), "This protected save is not confirmed. Stay here to check its result.");
  const retain = (value: Pending) => { entryRef.current = value; recovery.set(value); };
  const finish = async (value: Pending, result: CareReceipt) => {
    if (result.id !== value.caseId || typeof result.revision !== "number" || result.revision < 1 || !result.receipt_id) throw new Error("The response did not confirm this exact protected save.");
    const accepted = { ...value, phase: "accepted" as const, result }; retain(accepted);
    if (!current()) return;
    await onAccepted(result);
    recovery.clear(value.commandId); operations.get(client)?.values.delete(value.commandId); entryRef.current = undefined;
  };
  const perform = async (value: Pending) => {
    const operation = operations.get(client)?.scope === scopeId ? operations.get(client)?.values.get(value.commandId) : undefined;
    if (pending.current || !current() || !operation) return;
    pending.current = true; setBusy(true); setError(""); setRetryReady(false); retain({ ...value, phase: "pending" });
    try { await finish(value, await operation(value.commandId)); }
    catch (cause) {
      const accepted = entryRef.current?.phase === "accepted";
      if (!accepted && exactRefusal(cause, value)) {
        recovery.clear(value.commandId); operations.get(client)?.values.delete(value.commandId); entryRef.current = undefined;
        if (current()) { setReviewNeeded(true); setError(cause instanceof Error ? cause.message : "Review the current protected record before sending again."); }
        return;
      }
      const uncertain = accepted || value.everUncertain || !(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500;
      if (uncertain) retain({ ...(entryRef.current ?? value), phase: accepted ? "accepted" : "unknown", everUncertain: true });
      else { recovery.clear(value.commandId); operations.get(client)?.values.delete(value.commandId); entryRef.current = undefined; }
      if (current()) setError(accepted ? "Saved. The updated view could not be loaded. Refresh the saved record."
        : uncertain ? "Save not confirmed. Check its result before sending another concern or action." : cause instanceof Error ? cause.message : "The protected save was not accepted.");
    } finally { pending.current = false; if (current()) setBusy(false); }
  };
  const recover = async () => {
    const value = entryRef.current;
    if (!value || pending.current || !current()) return;
    if (retryReady) return perform(value);
    pending.current = true; setBusy(true); setError("");
    try {
      if (value.phase === "accepted" && value.result) { await finish(value, value.result); return; }
      const result = await confirmCareCommand(schoolId, value.commandId);
      if (!current()) return;
      if (result.state === "accepted") await finish(value, result.result);
      else if (result.state === "not_accepted") { recovery.clear(value.commandId); operations.get(client)?.values.delete(value.commandId); entryRef.current = undefined; setError("This save was not accepted. Review the details before starting again."); }
      else if (result.state === "not_found") {
        const canRetry = operations.get(client)?.scope === scopeId && operations.get(client)?.values.has(value.commandId);
        setRetryReady(Boolean(canRetry)); setError(canRetry ? "No accepted result found. Retry this exact save with its unchanged details." : "No accepted result found yet. Keep this reference and check again; do not submit a replacement.");
      } else setError("This exact save is still being checked. Check again shortly.");
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The exact result could not be checked."); }
    finally { pending.current = false; if (current()) setBusy(false); }
  };
  return { busy, error, locked: busy || Boolean(entry), recovery: entry?.phase, retryReady, reviewNeeded, recover,
    reviewed: () => { if (!pending.current && !entryRef.current) { setReviewNeeded(false); setError(""); } },
    execute: (operation: Operation) => {
      if (entryRef.current || pending.current || reviewNeeded || !current()) return Promise.resolve();
      const commandId = crypto.randomUUID(), value: Pending = { commandId, caseId: caseId ?? commandId, slot, phase: "pending", everUncertain: false };
      operations.get(client)!.values.set(commandId, operation); retain(value); return perform(value);
    } };
}
