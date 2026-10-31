import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { actOnRepair, confirmFacilitiesCommand, getRepair, type RepairDetail } from "./facilitiesApi";
import { activateRepairExternalAccess } from "./repairExternalAccessApi";
import { facilitiesStaleProof } from "./useFacilitiesCommand";

type Phase = "activate" | "accept" | "saved";
interface Pending { phase: Phase; command: string; revision: number }

/** One user decision, two independently receipted owning commands. Never accept on an unknown activation. */
export function useRepairJobAcceptance(schoolId: string, repair: RepairDetail, refresh: () => Promise<unknown>) {
  const source = useRef(repair), phase = useRef<Phase>(repair.external_access?.can_activate ? "activate" : "accept");
  const commands = useRef({ activate: crypto.randomUUID(), accept: crypto.randomUUID() });
  const pending = useRef<Pending | null>(null), running = useRef(false), active = useRef(true), uncertain = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [recovery, setRecovery] = useState(false);
  const [retrySafe, setRetrySafe] = useState(false), [reviewRequired, setReviewRequired] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useUnsavedChangesGuard(busy || recovery, "This job acceptance is not confirmed. Stay here to check its result.");
  const saved = async () => {
    phase.current = "saved"; setRecovery(true);
    await refresh();
    if (active.current) { setRecovery(false); setError(""); }
  };
  const perform = async () => {
    if (running.current || !active.current) return;
    running.current = true; setBusy(true); setError(""); setRetrySafe(false);
    try {
      if (phase.current === "saved") { await saved(); return; }
      let current = pending.current ?? { phase: phase.current, command: commands.current[phase.current], revision: source.current.revision };
      pending.current = current;
      if (current.phase === "activate") {
        const grant = source.current.external_access;
        if (!grant) throw new Error("This job invitation changed. Check its current access.");
        const result = await activateRepairExternalAccess(schoolId, repair.id, grant.id, { command_id: current.command, expected_revision: current.revision });
        if (!active.current) return;
        if (result.id !== repair.id || result.external_access?.id !== grant.id || result.revision <= current.revision) throw new Error("Access activation was not confirmed for this job. Check its result.");
        source.current = result; phase.current = "accept"; uncertain.current = false;
        current = { phase: "accept", command: commands.current.accept, revision: result.revision }; pending.current = current;
      }
      const result = await actOnRepair(schoolId, repair.id, { command_id: current.command, expected_revision: current.revision, action: "accept", note: "" });
      if (!active.current) return;
      if (result.id !== repair.id || result.revision <= current.revision || result.state !== "accepted") throw new Error("Job acceptance was not confirmed. Check its result.");
      source.current = result; pending.current = null; uncertain.current = false; await saved();
    } catch (cause) {
      if (!active.current) return;
      const retained = pending.current;
      if (retained && facilitiesStaleProof(cause, retained.command, { id: repair.id, revision: retained.revision })) {
        uncertain.current = false; setRecovery(false); setReviewRequired(true); setError("This repair changed. Review the latest record before accepting it."); return;
      }
      const unknown = phase.current === "saved" || uncertain.current || !(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400;
      uncertain.current = unknown; setRecovery(unknown); setReviewRequired(!unknown);
      setError(phase.current === "saved" ? "Job accepted. The updated view could not load. Check the saved record."
        : `${cause instanceof Error ? cause.message : "Acceptance could not be confirmed."}${unknown ? " Check the result before another action." : phase.current === "accept" && repair.external_access?.can_activate ? " Access was connected, but acceptance was not saved. Review the repair." : ""}`);
    } finally { running.current = false; if (active.current) setBusy(false); }
  };
  const recover = async () => {
    if (retrySafe || phase.current === "saved") return perform();
    if (running.current || !pending.current || !active.current) return;
    running.current = true; setBusy(true); setError("");
    let advance = false;
    try {
      const current = pending.current, result = await confirmFacilitiesCommand(schoolId, repair.id, current.command);
      if (!active.current) return;
      if (result.state === "accepted") {
        if (result.result?.id !== repair.id || result.result.revision <= current.revision) throw new Error("This confirmation does not identify the job action. Check again.");
        if (current.phase === "activate") {
          if (result.result.external_access_id !== source.current.external_access?.id) throw new Error("The access confirmation does not identify this invitation. Check again.");
          source.current = { ...source.current, revision: result.result.revision };
          phase.current = "accept"; pending.current = { phase: "accept", command: commands.current.accept, revision: result.result.revision };
          uncertain.current = false; advance = true;
        } else { pending.current = null; uncertain.current = false; await saved(); }
      } else if (result.state === "not_found") { setRetrySafe(true); setError("No accepted result found. Retry the same action with its unchanged details."); }
      else if (result.state === "not_accepted") { uncertain.current = false; setRecovery(false); setReviewRequired(true); setError("This action was not accepted. Review the current repair before continuing."); }
      else setError("This action is still being checked. Check again shortly.");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The result could not be checked."); }
    finally { running.current = false; if (active.current) setBusy(false); }
    if (advance && active.current) await perform();
  };
  const review = async () => {
    if (running.current || recovery || !reviewRequired) return;
    running.current = true; setBusy(true);
    try {
      const current = await getRepair(schoolId, repair.id);
      if (!active.current) return;
      const access = current.external_access;
      if (!access || access.id !== repair.external_access?.id || !access.can_activate && !current.allowed_actions.accept) throw new Error("This job can no longer be accepted. Refresh the repair to see its current access.");
      source.current = current; phase.current = access.can_activate ? "activate" : "accept";
      pending.current = null; commands.current = { activate: crypto.randomUUID(), accept: crypto.randomUUID() }; setReviewRequired(false); setError("");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The repair could not be reviewed."); }
    finally { running.current = false; if (active.current) setBusy(false); }
  };
  return { busy, error, recovery, retrySafe, reviewRequired, accept: perform, recover, review, locked: busy || recovery || reviewRequired };
}
