import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
type FinanceWriteBinding = { invoiceId: string; expectedRevision: number; requestId?: string };

/** Unknown outcomes stay locked until their exact receipt or same-command retry.
 * A read of the account alone never proves that the command finished. */
export function useFinanceArrangementWrite(onReload: () => Promise<unknown>, onAccepted: () => void,
  confirm: (commandId: string) => Promise<{ state: "not_found" | "pending" | "accepted" | "not_accepted" } | undefined>,
  binding: () => FinanceWriteBinding) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [recovery, setRecovery] = useState<"unknown" | "accepted" | null>(null);
  const [retrySafe, setRetrySafe] = useState(false), [obsolete, setObsolete] = useState(false);
  const active = useRef(true), inFlight = useRef(false), command = useRef(crypto.randomUUID()), retainedWrite = useRef<((commandId: string) => Promise<unknown>) | null>(null);
  const retainedBinding = useRef<FinanceWriteBinding | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useUnsavedChangesGuard(busy || recovery !== null, "This fee action is not confirmed. Stay here to check its exact result.");
  const perform = async (write: (commandId: string) => Promise<unknown>, expected: FinanceWriteBinding) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setRetrySafe(false); setError(""); retainedWrite.current = write; retainedBinding.current = expected;
    const recovering = recovery !== null;
    let accepted = false;
    try {
      await write(command.current); accepted = true;
      if (!active.current) return;
      await onReload();
      if (active.current) onAccepted();
    } catch (cause) {
      if (!active.current) return;
      const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const error = object(object(cause instanceof ApiError ? cause.details : undefined).error), proof = object(object(error.fields).fee_arrangement_obsolete);
      const permanentlyObsolete = cause instanceof ApiError && cause.status === 409 && error.code === "fee_arrangement_obsolete"
        && proof.confirmation === "permanently_inapplicable" && proof.invoice_id === expected.invoiceId && proof.command_id === command.current
        && proof.expected_revision === expected.expectedRevision && proof.request_id === expected.requestId
        && Number.isSafeInteger(proof.current_revision) && Number(proof.current_revision) >= expected.expectedRevision
        && (proof.reason === "stream_advanced" && Number(proof.current_revision) > expected.expectedRevision || proof.reason === "ledger_basis_diverged");
      const uncertain = !permanentlyObsolete && (recovering || !(cause instanceof ApiError) || cause.status < 400 || cause.status >= 500 || cause.status === 409);
      setRecovery(accepted ? "accepted" : uncertain ? "unknown" : null);
      setObsolete(permanentlyObsolete);
      setError(accepted ? "Saved. Refresh this account to see the result." : cause instanceof Error ? cause.message : "This action was not confirmed.");
      if (!accepted && !uncertain) command.current = crypto.randomUUID();
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const execute = (write: (commandId: string) => Promise<unknown>) => recovery ? Promise.resolve() : perform(write, binding());
  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const receipt = await confirm(command.current);
      if (!active.current) return;
      if (receipt?.state === "accepted") { setRecovery("accepted"); await onReload(); if (active.current) onAccepted(); }
      else if (receipt?.state === "not_found") { setRetrySafe(true); setError("No accepted result was found. You can retry this exact action; its details remain locked."); }
      else if (receipt?.state === "not_accepted") { setRecovery(null); setRetrySafe(false); setObsolete(true); command.current = crypto.randomUUID(); retainedWrite.current = null; setError("This action was not accepted. Refresh and review the current account before sending again."); }
      else { setError("This action is still unconfirmed. Refresh again before continuing."); }
    }
    catch { if (active.current) setError("The account could not be refreshed. No further action was sent."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const retrySame = () => retrySafe && retainedWrite.current && retainedBinding.current ? perform(retainedWrite.current, retainedBinding.current) : Promise.resolve();
  const clearObsolete = () => { setObsolete(false); setError(""); command.current = crypto.randomUUID(); };
  return { busy, error, recovery, retrySafe, obsolete, locked: busy || Boolean(recovery), execute, refresh, retrySame, clearObsolete };
}
