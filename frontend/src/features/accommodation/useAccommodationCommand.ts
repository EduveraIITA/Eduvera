import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { confirmAccommodationCommand } from "./accommodationApi";

interface Identity { id: string; revision: number }
function obsoleteProof(error: unknown, commandId: string, identity?: Identity) {
  if (!(error instanceof ApiError) || error.status !== 409 || !identity) return false;
  const envelope = error.details as { error?: { code?: unknown; fields?: { accommodation_obsolete?: Record<string, unknown> } } };
  const proof = envelope?.error?.fields?.accommodation_obsolete;
  return envelope?.error?.code === "accommodation_obsolete" && proof?.confirmation === "permanently_inapplicable"
    && proof.receipt_state === "absent" && proof.reason === "stream_advanced" && proof.source_id === identity.id
    && proof.command_id === commandId && proof.expected_revision === identity.revision
    && typeof proof.current_revision === "number" && proof.current_revision > identity.revision;
}

/** The owning receipt resolves uncertainty; a refresh never repeats an accepted action. */
export function useAccommodationCommand({ schoolId, sourceId, setup = false, onAccepted }: {
  schoolId: string; sourceId?: string; setup?: boolean; onAccepted: (id: string, result?: unknown) => Promise<unknown>;
}) {
  const command = useRef(crypto.randomUUID()), active = useRef(true), pending = useRef(false), accepted = useRef(false);
  const acceptedResult = useRef<unknown>(undefined);
  const retained = useRef<{ operation: (commandId: string) => Promise<unknown>; identity?: Identity } | null>(null);
  const [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<"unknown" | "accepted" | null>(null);
  const [retrySafe, setRetrySafe] = useState(false), [obsolete, setObsolete] = useState(false), [error, setError] = useState("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useUnsavedChangesGuard(busy || Boolean(recovery), "This accommodation action is not confirmed. Stay here to check its result.");
  const finish = () => onAccepted(sourceId ?? (acceptedResult.current as { id?: string } | undefined)?.id ?? command.current, acceptedResult.current);
  const perform = async () => {
    if (pending.current || !active.current || !retained.current) return;
    pending.current = true; setBusy(true); setError(""); setRetrySafe(false);
    try {
      if (!accepted.current) {
        const result = await retained.current.operation(command.current), proof = result as { id?: unknown; revision?: unknown } | null;
        if (!proof || typeof proof.id !== "string" || typeof proof.revision !== "number" || proof.revision < 1 || sourceId && proof.id !== sourceId || !setup && !sourceId && proof.id !== command.current)
          throw new Error("The response did not confirm this exact action. Keep it here and check its result.");
        acceptedResult.current = result; accepted.current = true;
      }
      if (active.current) { setRecovery("accepted"); await finish(); }
    } catch (cause) {
      if (!active.current) return;
      if (!accepted.current && obsoleteProof(cause, command.current, retained.current.identity)) {
        retained.current = null; setRecovery(null); setObsolete(true); setError("This record changed. Review the current arrangement before sending again."); return;
      }
      const refused = cause instanceof ApiError && cause.status === 422;
      const uncertain = accepted.current || (!refused && Boolean(recovery)) || !(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400;
      setRecovery(accepted.current ? "accepted" : uncertain ? "unknown" : null);
      setError(accepted.current ? "Saved. The updated view could not be loaded. Refresh the saved record."
        : `${cause instanceof Error ? cause.message : "The action could not be confirmed."}${uncertain ? " Check its result before trying another action." : ""}`);
      if (!uncertain) { retained.current = null; command.current = crypto.randomUUID(); }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const recover = async () => {
    if (retrySafe && !accepted.current) return perform();
    if (pending.current || !active.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (accepted.current) { await finish(); return; }
      const result = await confirmAccommodationCommand(schoolId, sourceId ?? command.current, command.current, setup);
      if (!active.current) return;
      if (result.state === "accepted") {
        if (!result.result || typeof result.result.revision !== "number" || result.result.revision < 1 || typeof result.result.id !== "string"
          || sourceId && result.result.id !== sourceId || !setup && !sourceId && result.result.id !== command.current)
          throw new Error("The confirmation belongs to another record. Keep this action here and check again.");
        acceptedResult.current = result.result; accepted.current = true; setRecovery("accepted"); await finish();
      } else if (result.state === "not_found") { setRetrySafe(true); setError("No accepted result was found. Retry the same action with its unchanged details."); }
      else if (result.state === "not_accepted") { retained.current = null; setRecovery(null); setObsolete(true); setError("This action was not accepted. Review the current record before sending again."); }
      else setError("This action is still being checked. Check again shortly.");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The result could not be checked."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return { busy, error, recovery, retrySafe, obsolete, locked: busy || Boolean(recovery) || obsolete,
    execute: (operation: (commandId: string) => Promise<unknown>, identity?: Identity) => {
      if (pending.current || retained.current || obsolete) return Promise.resolve(); retained.current = { operation, identity }; return perform();
    }, recover,
    reviewed: () => { if (!pending.current && obsolete) { setObsolete(false); setError(""); command.current = crypto.randomUUID(); } },
  };
}
