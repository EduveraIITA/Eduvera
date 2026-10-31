import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import type { FeeCommandConfirmation } from "./personFeesApi";

/** A failed read cannot turn an uncertain financial command into a fresh write. */
export function useFeeCommand(refresh: () => Promise<unknown>, onAccepted: () => void,
  confirm: (commandId: string) => Promise<FeeCommandConfirmation>, proveObsolete?: (error: unknown, commandId: string) => boolean) {
  const active = useRef(true), pending = useRef(false), commandId = useRef(crypto.randomUUID());
  const retained = useRef<((commandId: string) => Promise<unknown>) | null>(null), saved = useRef(false);
  const [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<"unknown" | "accepted" | null>(null);
  const [retrySafe, setRetrySafe] = useState(false), [error, setError] = useState("");
  const [obsolete, setObsolete] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useUnsavedChangesGuard(busy || Boolean(recovery), "This fee action is not confirmed. Stay here to check its result.");
  const finish = async () => { await refresh(); if (active.current) onAccepted(); };
  const perform = async (operation: (id: string) => Promise<unknown>) => {
    if (pending.current || !active.current) return;
    pending.current = true; retained.current = operation; setBusy(true); setError(""); setRetrySafe(false);
    try { if (!saved.current) { await operation(commandId.current); saved.current = true; } if (active.current) { setRecovery("accepted"); await finish(); } }
    catch (cause) {
      if (!active.current) return;
      if (!saved.current && proveObsolete?.(cause, commandId.current)) {
        retained.current = null; setRecovery(null); setObsolete(true); setError("The record changed. Your entries are kept; review the current record before sending again."); return;
      }
      const uncertain = saved.current || Boolean(recovery) || !(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400;
      setRecovery(saved.current ? "accepted" : uncertain ? "unknown" : null);
      setError(saved.current ? "Saved. Refresh the view to see the result." : `${cause instanceof Error ? cause.message : "The action was not confirmed."}${uncertain ? " Your choices are kept and locked until the result is checked." : ""}`);
      if (!uncertain) { retained.current = null; commandId.current = crypto.randomUUID(); }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const check = async () => {
    if (pending.current || !active.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (saved.current) { await finish(); return; }
      const receipt = await confirm(commandId.current); if (!active.current) return;
      if (receipt.state === "accepted") { saved.current = true; setRecovery("accepted"); await finish(); }
      else if (receipt.state === "not_found") { setRetrySafe(true); setError("No result was found. Retry this same action; the details stay locked."); }
      else if (receipt.state === "not_accepted") { retained.current = null; setRecovery(null); setObsolete(true); setError("This action was not accepted. Review the current record before sending again."); }
      else setError("This action is still being checked. Check again shortly.");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The result could not be checked."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return { busy, recovery, retrySafe, error, obsolete, locked: busy || Boolean(recovery),
    clearObsolete: () => { if (pending.current || !obsolete) return; setObsolete(false); setError(""); commandId.current = crypto.randomUUID(); },
    execute: (operation: (id: string) => Promise<unknown>) => recovery || obsolete ? Promise.resolve() : perform(operation), check,
    retry: () => retrySafe && retained.current ? perform(retained.current) : Promise.resolve() };
}
