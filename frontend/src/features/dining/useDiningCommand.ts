import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { confirmDiningCommand } from "./diningApi";
import { useDiningRecovery } from "./DiningCommandRecovery";

interface Identity { id: string; revision: number; planVersion?: true }
type ProofIdentity = Identity | readonly Identity[];
function obsoleteProof(error: unknown, commandId: string, identity?: ProofIdentity) {
  if (!(error instanceof ApiError) || error.status !== 409 || !identity) return false;
  const envelope = error.details as { error?: { code?: unknown; fields?: { dining_obsolete?: Record<string, unknown> } } };
  const proof = envelope?.error?.fields?.dining_obsolete;
  const identities: readonly Identity[] = Array.isArray(identity) ? identity : [identity as Identity];
  return envelope?.error?.code === "dining_obsolete" && proof?.confirmation === "permanently_inapplicable"
    && proof.receipt_state === "absent" && proof.command_id === commandId
    && identities.some(item => proof.source_id === item.id && proof.expected_revision === item.revision
      && typeof proof.current_revision === "number" && Number.isInteger(proof.current_revision)
      && (proof.reason === "stream_advanced" && proof.current_revision > item.revision
        || proof.reason === "plan_superseded" && item.planVersion === true
          && proof.expected_plan_version_id === item.id && proof.current_revision > 0
          && typeof proof.current_plan_version_id === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.current_plan_version_id)
          && proof.current_plan_version_id !== item.id));
}

/** Keep the exact intent until its owning receipt resolves uncertainty. */
export function useDiningCommand({ schoolId, sourceId, kind, onAccepted }: {
  schoolId: string; sourceId?: string; kind: "service" | "session" | "issue" | "plan"; onAccepted: (id: string) => Promise<unknown>;
}) {
  // The keyed recovery provider owns this command's original actor/world. A late
  // response must never move its reference into a newly selected scope.
  const registryRef = useRef(useDiningRecovery());
  const command = useRef(crypto.randomUUID()), active = useRef(true), pending = useRef(false), accepted = useRef(false);
  const uncertain = useRef(false);
  const retained = useRef<{ operation: (commandId: string) => Promise<unknown>; identity?: ProofIdentity } | null>(null);
  const [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<"unknown" | "accepted" | null>(null);
  const [retrySafe, setRetrySafe] = useState(false), [obsolete, setObsolete] = useState(false), [error, setError] = useState("");
  useEffect(() => { const registry = registryRef.current; active.current = true; return () => { active.current = false; registry?.detach(command.current); }; }, []);
  useUnsavedChangesGuard(busy || Boolean(recovery), "This Dining action is not confirmed. Stay here to check its result.");
  const finish = async () => { await onAccepted(sourceId ?? command.current); registryRef.current?.clear(command.current); };
  const perform = async () => {
    if (pending.current || !active.current || !retained.current) return;
    pending.current = true; setBusy(true); setError(""); setRetrySafe(false); registryRef.current?.phase(command.current, "pending");
    try {
      if (!accepted.current) {
        const result = await retained.current.operation(command.current), proof = result as { id?: unknown; kind?: unknown; revision?: unknown } | null;
        if (!proof || proof.id !== (sourceId ?? command.current) || proof.kind !== kind || !Number.isInteger(proof.revision) || (proof.revision as number) < 1)
          throw new Error("The response did not confirm this exact action. Keep it here and check its result.");
        accepted.current = true; registryRef.current?.phase(command.current, "accepted");
      }
      if (active.current) { setRecovery("accepted"); await finish(); }
    } catch (cause) {
      if (!accepted.current && obsoleteProof(cause, command.current, retained.current.identity)) {
        registryRef.current?.clear(command.current); retained.current = null; uncertain.current = false;
        if (active.current) { setRecovery(null); setObsolete(true); setError("This record changed. Review its current state before sending again."); }
        return;
      }
      // A later permission or validation error describes this attempt, not the
      // outcome of an earlier lost response. Only its exact terminal receipt or
      // source-bound obsolete proof can release an already uncertain intent.
      uncertain.current = uncertain.current || accepted.current || !(cause instanceof ApiError)
        || cause.status === 409 || cause.status >= 500 || cause.status < 400;
      if (uncertain.current) registryRef.current?.phase(command.current, accepted.current ? "accepted" : "unknown");
      else { registryRef.current?.clear(command.current); retained.current = null; command.current = crypto.randomUUID(); }
      if (!active.current) return;
      setRecovery(accepted.current ? "accepted" : uncertain.current ? "unknown" : null);
      setError(accepted.current ? "Saved. The updated view could not be loaded. Refresh the saved record."
        : `${cause instanceof Error ? cause.message : "The action could not be confirmed."}${uncertain.current ? " Check its result before trying another action." : ""}`);
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const recover = async () => {
    if (retrySafe && !accepted.current) return perform();
    if (pending.current || !active.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (accepted.current) { await finish(); return; }
      const result = await confirmDiningCommand(schoolId, command.current, sourceId ?? command.current);
      if (result.state === "accepted") {
        if (result.result?.id !== (sourceId ?? command.current) || result.result.kind !== kind || !Number.isInteger(result.result.revision) || result.result.revision < 1)
          throw new Error("The confirmation belongs to another record. Keep this action here and check again.");
        accepted.current = true; registryRef.current?.phase(command.current, "accepted");
        if (active.current) { setRecovery("accepted"); await finish(); }
      } else if (result.state === "not_accepted") {
        registryRef.current?.clear(command.current); retained.current = null; uncertain.current = false;
        if (active.current) { setRecovery(null); setObsolete(true); setError("This action was not accepted. Review the current record before sending again."); }
      } else if (active.current && result.state === "not_found") { setRetrySafe(true); setError("No accepted result was found. Retry the same action with its unchanged details."); }
      else if (active.current) setError("This action is still being checked. Check again shortly.");
    } catch (cause) { if (active.current) setError(accepted.current ? "Saved. The updated view could not be loaded. Refresh the saved record." : cause instanceof Error ? cause.message : "The result could not be checked."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return { busy, error, recovery, retrySafe, obsolete, locked: busy || Boolean(recovery) || obsolete,
    execute: (operation: (commandId: string) => Promise<unknown>, identity?: ProofIdentity) => {
      if (pending.current || retained.current || obsolete) return Promise.resolve(); retained.current = { operation, identity }; registryRef.current?.retain({ commandId: command.current, sourceId: sourceId ?? command.current, kind, phase: "pending", detached: false }); return perform();
    }, recover,
    reviewed: () => { if (!pending.current && obsolete) { setObsolete(false); setError(""); command.current = crypto.randomUUID(); } },
  };
}
