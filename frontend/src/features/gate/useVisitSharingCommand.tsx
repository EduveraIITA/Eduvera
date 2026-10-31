import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { confirmVisitSharingCommand, type VisitSharingReceipt } from "./visitSharingApi";

/** One immutable effect at a time. A receipt proves the effect, never the current view. */
export function useVisitSharingCommand<T>({ schoolId, visitId, onAccepted, accepts }: {
  schoolId: string; visitId: string; onAccepted: (result?: T, receipt?: VisitSharingReceipt) => Promise<unknown>;
  accepts: (receipt: VisitSharingReceipt) => boolean;
}) {
  const active = useRef(true), pending = useRef(false), command = useRef(crypto.randomUUID());
  const retainedAccepts = useRef(accepts), retainedAccepted = useRef(onAccepted);
  const expectedRevision = useRef<number | null>(null);
  const retained = useRef<((id: string) => Promise<T>) | null>(null), accepted = useRef(false), result = useRef<T | undefined>(undefined), receipt = useRef<VisitSharingReceipt | undefined>(undefined);
  const [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<"unknown" | "accepted" | null>(null), [retrySafe, setRetrySafe] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useUnsavedChangesGuard(busy || Boolean(recovery), "This visit action is not confirmed. Stay here to check its result.");
  const completed = () => { if (!active.current) return; retained.current = null; accepted.current = false; result.current = undefined; receipt.current = undefined; command.current = crypto.randomUUID(); setRecovery(null); setRetrySafe(false); };
  const perform = async () => {
    if (pending.current || !active.current || !retained.current) return;
    pending.current = true; setBusy(true); setError(""); setRetrySafe(false);
    try {
      if (!accepted.current) { result.current = await retained.current(command.current); accepted.current = true; }
      if (active.current) { setRecovery("accepted"); await retainedAccepted.current(result.current, receipt.current); completed(); }
    } catch (cause) {
      if (!active.current) return;
      const envelope = cause instanceof ApiError ? cause.details as { error?: { code?: string; fields?: { visit_sharing_changed?: Record<string, unknown> } } } : undefined, proof = envelope?.error?.fields?.visit_sharing_changed;
      const obsolete = !accepted.current && cause instanceof ApiError && cause.status === 409 && envelope?.error?.code === "visit_sharing_changed" && proof?.confirmation === "permanently_inapplicable" && proof.receipt_state === "absent" && proof.visit_id === visitId && proof.command_id === command.current && proof.expected_revision === expectedRevision.current && typeof proof.current_revision === "number" && proof.current_revision > (expectedRevision.current ?? -1);
      if (obsolete) { retained.current = null; setRecovery(null); setStale(true); setError("This visit changed. Review its current details before saving."); return; }
      const definite = !accepted.current && recovery !== "unknown" && cause instanceof ApiError && [400, 401, 403, 404, 410, 422].includes(cause.status);
      setRecovery(accepted.current ? "accepted" : definite ? null : "unknown");
      setError(accepted.current ? "Saved. The current view could not refresh. Check the saved result." : `${cause instanceof Error ? cause.message : "The action was not confirmed."}${definite ? "" : " Check its result before another action."}`);
      if (definite) { retained.current = null; command.current = crypto.randomUUID(); }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const recover = async () => {
    if (retrySafe && !accepted.current) return perform();
    if (pending.current || !active.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (accepted.current) { await retainedAccepted.current(result.current, receipt.current); completed(); return; }
      const confirmation = await confirmVisitSharingCommand(schoolId, visitId, command.current);
      if (!active.current) return;
      if (confirmation.state === "accepted") {
        if (confirmation.result.visit_id !== visitId || confirmation.result.revision !== (expectedRevision.current ?? -1) + 1 || !retainedAccepts.current(confirmation.result)) throw new Error("The receipt does not confirm this exact action. No other action was sent.");
        receipt.current = confirmation.result; accepted.current = true; setRecovery("accepted"); await retainedAccepted.current(undefined, confirmation.result); completed();
      } else if (confirmation.state === "not_found") { setRetrySafe(true); setError("No saved result was found. Retry the same action with its unchanged details."); }
      else if (confirmation.state === "not_accepted") { retained.current = null; setRecovery(null); setStale(true); setError("This action was not accepted. Review the current visit before trying again."); }
      else setError("This action is still being checked. Check again shortly.");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The result could not be checked."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return { busy, recovery, retrySafe, stale, error, locked: busy || Boolean(recovery) || stale,
    execute: (operation: (id: string) => Promise<T>, revision: number) => { if (pending.current || retained.current || stale) return Promise.resolve(); retained.current = operation; retainedAccepts.current = accepts; retainedAccepted.current = onAccepted; expectedRevision.current = revision; return perform(); }, recover,
    reviewed: () => { if (!pending.current && stale) { setStale(false); setError(""); command.current = crypto.randomUUID(); } },
  };
}
export function VisitSharingFeedback({ write, onReview }: { write: Pick<ReturnType<typeof useVisitSharingCommand>, "error" | "recovery" | "busy" | "recover" | "retrySafe" | "stale">; onReview: () => unknown }) {
  return <div className="visits-feedback">{write.error ? <p className="visits-error" role="alert">{write.error}</p> : null}{write.recovery ? <button type="button" className="is-secondary" disabled={write.busy} onClick={() => void write.recover()}>{write.busy ? "Checking…" : write.recovery === "accepted" ? "Refresh saved result" : write.retrySafe ? "Retry same action" : "Check result"}</button> : null}{write.stale ? <button type="button" className="is-secondary" onClick={() => void onReview()}>Review latest</button> : null}</div>;
}
