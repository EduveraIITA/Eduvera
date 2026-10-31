import { useEffect, useRef, useState } from "react";
import { executionRequestIdentity } from "../../lib/executionRequestScope";
import { confirmCareCommand } from "./api";
import { useCareRecovery } from "./useCareSave";

/** Detached recovery contains only opaque references, never private drafts. */
export function CarePendingReceipts({ schoolId, scope, onResume, onConfirmed }: { schoolId: string; scope: readonly unknown[]; onResume?: (caseId: string, intake: boolean) => void; onConfirmed?: () => Promise<void> }) {
  const registry = useCareRecovery(scope), [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState("");
  const active = useRef(true), epoch = useRef(executionRequestIdentity());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const current = () => active.current && epoch.current === executionRequestIdentity();
  if (!registry.pending.length && !message) return null;
  const check = async (commandId: string, caseId: string) => {
    setBusy(commandId); setMessage("");
    try {
      const retained = registry.pending.find(entry => entry.commandId === commandId);
      const result = retained?.phase === "accepted" && retained.result ? { state: "accepted" as const, result: retained.result } : await confirmCareCommand(schoolId, commandId);
      if (!current()) return;
      if (result.state === "accepted") {
        if (result.result.id !== caseId || !result.result.receipt_id || result.result.revision < 1) throw new Error("This receipt does not confirm the pending save. Keep the reference and check again.");
        if (retained) registry.set({ ...retained, phase: "accepted", result: result.result });
        await onConfirmed?.();
        if (!current()) return;
        registry.clear(commandId); setMessage("Saved. Current access still controls which case details you can open.");
      } else if (result.state === "not_accepted") { registry.clear(commandId); setMessage("This exact save was not accepted. Review the current record before starting again."); }
      else setMessage(result.state === "not_found" ? "No accepted result found yet. Resume this exact save; do not submit a replacement." : "This exact result is still awaiting confirmation.");
    } catch (cause) { if (current()) setMessage(cause instanceof Error ? cause.message : "The result could not be checked."); }
    finally { if (current()) setBusy(null); }
  };
  return <section className="care-recovery" aria-label="Protected save confirmation"><strong>Protected save awaiting confirmation</strong>
    {registry.pending.map(entry => <div className="care-recovery__actions" key={entry.commandId}><button className="care-secondary" type="button" disabled={Boolean(busy)} onClick={() => void check(entry.commandId, entry.caseId)}>{busy === entry.commandId ? "Checking…" : entry.phase === "accepted" ? "Refresh saved record" : "Check exact result"}</button>{onResume && <button className="care-link" type="button" disabled={Boolean(busy)} onClick={() => onResume(entry.caseId, entry.slot === "intake")}>Resume save</button>}</div>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
