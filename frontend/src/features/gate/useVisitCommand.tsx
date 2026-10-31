import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { confirmVisitCommand, type VisitDetail } from "./visitApi";

/** Retain one exact command and payload until its owning receipt resolves uncertainty. */
export function useVisitCommand({ schoolId, sourceId, onAccepted }: {
  schoolId: string; sourceId?: string; onAccepted: (result: VisitDetail) => Promise<unknown>;
}) {
  const command = useRef(crypto.randomUUID()), active = useRef(true), pending = useRef(false);
  const expectedRevision = useRef<number | null>(null);
  const retained = useRef<((commandId: string) => Promise<VisitDetail>) | null>(null), accepted = useRef<VisitDetail | null>(null);
  const [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<"unknown" | "accepted" | null>(null);
  const [retrySafe, setRetrySafe] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useUnsavedChangesGuard(busy || Boolean(recovery), "This visit action is not confirmed. Stay here to check its result.");
  const assertResult = (result: VisitDetail) => {
    if (!result?.visit || result.visit.id !== (sourceId ?? command.current) || !Number.isInteger(result.visit.revision) || result.visit.revision < 1)
      throw new Error("The response did not confirm this exact visit. Check its result.");
    return result;
  };
  const perform = async () => {
    if (pending.current || !active.current || !retained.current) return;
    pending.current = true; setBusy(true); setError(""); setRetrySafe(false);
    try {
      if (!accepted.current) accepted.current = assertResult(await retained.current(command.current));
      if (active.current) { setRecovery("accepted"); await onAccepted(accepted.current); }
    } catch (cause) {
      if (!active.current) return;
      const envelope = cause instanceof ApiError ? cause.details as { error?: { code?: string; fields?: { visit_changed?: Record<string, unknown> } } } : undefined;
      const proof = envelope?.error?.fields?.visit_changed;
      const obsolete = cause instanceof ApiError && cause.status === 409 && envelope?.error?.code === "visit_changed"
        && proof?.confirmation === "permanently_inapplicable" && proof.receipt_state === "absent"
        && proof.visit_id === (sourceId ?? command.current) && proof.command_id === command.current
        && typeof proof.expected_revision === "number" && proof.expected_revision === expectedRevision.current && typeof proof.current_revision === "number" && proof.current_revision > proof.expected_revision;
      const refused = cause instanceof ApiError && ([400, 401, 403, 404, 410, 422].includes(cause.status) || envelope?.error?.code === "visit_person_changed");
      const uncertain = Boolean(accepted.current) || Boolean(recovery) || !refused;
      if (!accepted.current && obsolete) {
        retained.current = null; setStale(true); setRecovery(null); setError("This visit changed. Review the latest details before saving.");
      } else {
        setRecovery(accepted.current ? "accepted" : uncertain ? "unknown" : null);
        setError(accepted.current ? "Saved. The updated view could not load. Refresh the saved visit."
          : `${cause instanceof Error ? cause.message : "The action could not be confirmed."}${uncertain ? " Check its result before making another change." : ""}`);
        if (!uncertain) { retained.current = null; command.current = crypto.randomUUID(); }
      }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const recover = async () => {
    if (retrySafe && !accepted.current) return perform();
    if (pending.current || !active.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (accepted.current) { await onAccepted(accepted.current); return; }
      const receipt = await confirmVisitCommand(schoolId, sourceId ?? command.current, command.current);
      if (!active.current) return;
      if (receipt.state === "accepted") { accepted.current = assertResult(receipt.result); setRecovery("accepted"); await onAccepted(accepted.current); }
      else if (receipt.state === "not_found") { setRetrySafe(true); setError("No saved result was found. Retry the same action with its unchanged details."); }
      else if (receipt.state === "not_accepted") { retained.current = null; setRecovery(null); setStale(true); setError("This action was not accepted. Review the latest visit before saving again."); }
      else setError("The action is still being checked. Check again shortly.");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The result could not be checked."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return { busy, recovery, retrySafe, stale, error, locked: busy || Boolean(recovery) || stale,
    execute: (operation: (commandId: string) => Promise<VisitDetail>, revision: number) => { if (pending.current || retained.current || stale) return Promise.resolve(); retained.current = operation; expectedRevision.current = revision; return perform(); }, recover,
    reviewed: () => { if (!pending.current && stale) { setStale(false); setError(""); command.current = crypto.randomUUID(); } },
  };
}

export function VisitWriteFeedback({ write, onReview }: { write: ReturnType<typeof useVisitCommand>; onReview: () => unknown }) {
  return <div className="visits-feedback">{write.error ? <p className="visits-error" role="alert">{write.error}</p> : null}
    {write.recovery ? <button type="button" className="is-secondary" disabled={write.busy} onClick={() => void write.recover()}>{write.busy ? "Checking…" : write.recovery === "accepted" ? "Refresh saved visit" : write.retrySafe ? "Retry same action" : "Check result"}</button> : null}
    {write.stale ? <button type="button" className="is-secondary" disabled={write.busy} onClick={() => void onReview()}>Review latest</button> : null}
  </div>;
}
