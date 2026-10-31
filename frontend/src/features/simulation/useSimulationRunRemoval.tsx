import { useLayoutEffect, useRef, useState } from "react";
import { getSimulationRun, removeSimulationRun, stopSimulationRun, type SimulationRunView } from "./simulationApi";

type RemovalIntent = {
  runId: string; name: string; draft: boolean; reviewedRevision: number;
  removalRevision: number | null; phase: "ready" | "reconcile" | "remove" | "accepted";
  submitted: boolean;
};

function revision(run: SimulationRunView) {
  return Number.isSafeInteger(run.revision) && (run.revision ?? 0) > 0 ? run.revision! : null;
}

export function removalUnavailable(run: SimulationRunView) {
  if (!run.created_by_me) return "Only its owner can remove this simulation.";
  if (run.retention.world_discarded_at || run.retention.state === "deleted") return "Removed. Run history is kept.";
  if (run.retention.pinned) return "Unpin this simulation before removing it.";
  if (["preparing", "running", "paused"].includes(run.status)) return "Stop this simulation before removing it.";
  if (revision(run) === null) return "Refresh to check removal availability.";
  if (run.status === "draft") return run.available_actions.includes("stop") ? null : "This draft is not ready to discard.";
  return run.available_actions.includes("remove") ? null : "This simulation is in use or not ready to remove.";
}

export function useSimulationRunRemoval({ schoolId, refresh, restoreFocus }: {
  schoolId: string; refresh: () => Promise<void>; restoreFocus: (runId: string) => void;
}) {
  const [intent, setIntent] = useState<RemovalIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { if (intent && intent.phase !== "accepted") heading.current?.focus({ preventScroll: true }); }, [intent]);

  const choose = (run: SimulationRunView) => {
    if (pending.current || intent || removalUnavailable(run) !== null) return;
    setError(null); setNotice(null);
    setIntent({ runId: run.id, name: run.name.trim() || "Untitled simulation", draft: run.status === "draft",
      reviewedRevision: revision(run)!, removalRevision: run.status === "draft" ? null : revision(run),
      phase: "ready", submitted: false });
  };

  const refreshOnly = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await refresh(); if (intent?.phase === "accepted") setIntent(null); }
    catch (cause) { setError(`${intent?.phase === "accepted" ? "Removed, but the list could not refresh." : "Simulations could not refresh."} ${cause instanceof Error ? cause.message : "Please try again."}`); }
    finally { pending.current = false; setBusy(false); }
  };

  const remove = async () => {
    if (!intent || intent.phase === "accepted" || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    let current = { ...intent, submitted: true };
    setIntent(current);
    try {
      if (current.draft && current.removalRevision === null) {
        let stopped: SimulationRunView;
        if (current.phase === "reconcile") {
          // A lost response is not permission to send Stop again or to adopt a
          // newer run. Reconcile this exact reviewed transition with GET only.
          stopped = (await getSimulationRun(schoolId, current.runId)).run;
        } else {
          current = { ...current, phase: "reconcile" }; setIntent(current);
          stopped = (await stopSimulationRun(schoolId, current.runId, {
            expected_revision: current.reviewedRevision, expected_status: "draft",
          })).run;
        }
        if (stopped.status !== "stopped" || stopped.started_at !== null
          || revision(stopped) !== current.reviewedRevision + 1) {
          throw new Error("The draft changed or has not stopped. Close this confirmation, refresh, and review it again.");
        }
        current = { ...current, phase: "remove", removalRevision: revision(stopped) }; setIntent(current);
      }
      // Keep this exact revision after a lost response, even when a later GET
      // omits the row or returns a newer revision. Native receipts own replay.
      await removeSimulationRun(schoolId, current.runId, { expected_revision: current.removalRevision! });
      current = { ...current, phase: "accepted" }; setIntent(current);
      setNotice(`${current.name} ${current.draft ? "discarded" : "removed"}. Run history is kept.`);
      await refresh(); setIntent(null); restoreFocus(current.runId);
    } catch (cause) {
      setError(`${current.phase === "accepted" ? "Removed. Refresh the list to continue." : current.phase === "reconcile" ? "Discard is not confirmed. Retry checks its current state without stopping it again." : "Removal is not confirmed. Retry this same removal or refresh the list."} ${cause instanceof Error ? cause.message : "Please try again."}`);
    } finally { pending.current = false; setBusy(false); }
  };

  const confirmation = intent && intent.phase !== "accepted" ? (
    <div className="simulation-removal-confirmation" role="group" aria-label={`${intent.draft ? "Discard" : "Remove"} ${intent.name}`}>
      <h4 ref={heading} tabIndex={-1}>{intent.draft ? `Discard ${intent.name}?` : `Remove ${intent.name}?`}</h4>
      <p>{intent.draft ? "This stops the unused draft and removes its isolated changes." : "Its isolated changes cannot be recovered."} Live is unchanged. Run history stays.</p>
      {intent.submitted && !busy ? <p>The result is not confirmed. Closing does not cancel a submitted action.</p> : null}
      <div className="simulation-run-card__actions">
        <button type="button" disabled={busy} onClick={() => { const id = intent.runId; setIntent(null); setError(null); restoreFocus(id); }}>{intent.submitted ? "Close" : "Cancel"}</button>
        <button type="button" className="is-danger" disabled={busy} onClick={() => void remove()}>{busy ? "Working…" : intent.submitted ? "Retry" : intent.draft ? "Discard draft" : "Remove simulation"}</button>
      </div>
    </div>
  ) : null;
  return { intent, busy, error, notice, choose, refreshOnly, confirmation, locked: Boolean(intent) || busy };
}
