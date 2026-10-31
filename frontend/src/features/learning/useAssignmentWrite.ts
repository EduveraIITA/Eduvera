import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";

type WriteIdentity = { sourceId: string; expectedRevision: number; selectedPersons?: readonly { id: string; expected_revision: number }[] };
/** An uncertain write retains its exact command. Only a source-bound receipt-absent monotonic proof permits rebasing. */
export function useAssignmentWrite(refresh: () => Promise<unknown>, sourceKind: "assignment" | "offering" = "assignment") {
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [error, setError] = useState("");
  const [recovery, setRecovery] = useState<"none" | "unknown" | "accepted" | "obsolete">("none");
  const [obsoleteRevision, setObsoleteRevision] = useState<number | null>(null);
  const active = useRef(true), pending = useRef(false);
  const retained = useRef<{ key: string; retry: () => Promise<boolean> } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function run<T>(key: string, operation: (commandId: string) => Promise<T>, accepted?: (result: T) => void, identity?: WriteIdentity) {
    if (pending.current) return false;
    if (retained.current) return retained.current.key === key ? retained.current.retry() : false;
    const commandId = crypto.randomUUID();
    let saved = false, wasUnknown = false;
    const execute = async (): Promise<boolean> => {
      if (pending.current || !active.current) return false;
      pending.current = true; setBusy(true); setError("");
      try {
        if (!saved) {
          // The original closure and command are retained, never rebuilt from a newer render.
          const result = await operation(commandId); saved = true;
          if (!active.current) return false;
          accepted?.(result);
        }
        await refresh();
        if (active.current) { setLocked(false); setRecovery("none"); retained.current = null; }
        return true;
      } catch (cause) {
        if (active.current) {
          const envelope = cause instanceof ApiError && cause.status === 409 && typeof cause.details === "object" && cause.details !== null ? cause.details as Record<string, unknown> : null;
          const errorEnvelope = envelope && typeof envelope.error === "object" && envelope.error !== null ? envelope.error as Record<string, unknown> : null;
          const fields = errorEnvelope && typeof errorEnvelope.fields === "object" && errorEnvelope.fields !== null ? errorEnvelope.fields as Record<string, unknown> : null;
          const proofValue = fields?.[sourceKind === "offering" ? "offering_obsolete" : "assignment_obsolete"];
          const proof = typeof proofValue === "object" && proofValue !== null ? proofValue as Record<string, unknown> : null;
          const provedPermanent = proof?.code === (sourceKind === "offering" ? "learning.offering_revision_obsolete" : "assignment_revision_obsolete") && typeof proof.current_revision === "number" && proof.current_revision > (identity?.expectedRevision ?? Infinity)
            || sourceKind === "offering" && proof?.code === "learning.offering_selection_obsolete" && identity?.selectedPersons?.some(person => person.id === proof.person_id && person.expected_revision === proof.selected_revision)
              && typeof proof.current_person_revision === "number" && Number.isInteger(proof.current_person_revision) && typeof proof.selected_revision === "number" && proof.current_person_revision > proof.selected_revision
            || sourceKind === "assignment" && proof?.code === "assignment_state_obsolete" && ["instructions_published", "attempt_reviewed"].includes(String(proof.reason));
          const obsolete = !saved && identity && provedPermanent && proof?.confirmation === "permanently_inapplicable"
            && proof.receipt_state === "absent" && proof.handler === (sourceKind === "offering" ? "learning.offerings" : "learning.assignments") && proof.command_id === commandId
            && proof.source_id === identity.sourceId && proof.expected_revision === identity.expectedRevision
            && typeof proof.current_revision === "number" && Number.isInteger(proof.current_revision) && proof.current_revision >= identity.expectedRevision;
          if (obsolete) {
            retained.current = null; setLocked(true); setRecovery("obsolete"); setObsoleteRevision(proof.current_revision as number);
            setError("The saved version changed. Your text is kept. Review the current version before continuing."); return false;
          }
          const uncertain = saved || wasUnknown || !(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400;
          wasUnknown ||= uncertain;
          setLocked(uncertain); setRecovery(saved ? "accepted" : uncertain ? "unknown" : "none");
          setError(saved ? "Saved. The updated view could not be loaded. Refresh the view before continuing."
            : `${cause instanceof Error ? cause.message : "The action was not confirmed."}${uncertain ? " Keep this screen and retry the same action. Your inputs are locked until it is confirmed." : ""}`);
          if (!uncertain) retained.current = null;
        }
        return false;
      } finally { pending.current = false; if (active.current) setBusy(false); }
    };
    retained.current = { key, retry: execute };
    return execute();
  }
  async function recover() {
    if (pending.current) return;
    if (retained.current) {
      // Unknown => exact original command. Accepted => refresh only, without a second mutation.
      await retained.current.retry();
    } else {
      pending.current = true; setBusy(true); setError("");
      try { await refresh(); }
      catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Saved work is still unavailable."); }
      finally { pending.current = false; if (active.current) setBusy(false); }
    }
  }
  function resolveObsolete() {
    if (recovery !== "obsolete" || pending.current) return;
    setLocked(false); setRecovery("none"); setObsoleteRevision(null); setError("");
  }
  return { busy, locked, error, recovery, obsoleteRevision, run, recover, resolveObsolete };
}
