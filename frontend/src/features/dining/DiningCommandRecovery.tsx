import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { notifyManager, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { confirmDiningCommand } from "./diningApi";

interface RetainedCommand { commandId: string; sourceId: string; kind: "service" | "session" | "issue" | "plan"; phase: "pending" | "unknown" | "accepted"; detached: boolean }
interface RecoveryRegistry { retain: (entry: RetainedCommand) => void; phase: (id: string, phase: RetainedCommand["phase"]) => void; detach: (id: string) => void; clear: (id: string) => void }
const RecoveryContext = createContext<RecoveryRegistry | null>(null), empty: RetainedCommand[] = [];
export const useDiningRecovery = () => useContext(RecoveryContext);

/** Only exact receipt references survive a denied read; no private form/body is cached. */
export function DiningCommandRecovery({ schoolId, actorId, children }: { schoolId: string; actorId: string; children: ReactNode }) {
  const environment = useExecutionEnvironment();
  const namespace = JSON.stringify(executionEnvironmentQueryKey(environment, ["dining-command-recovery", schoolId, actorId]));
  // Remount local command state before another actor or world can use it. Opaque
  // references are outside the ordinary Dining cache's remove/invalidate root.
  return <DiningCommandRecoveryScope key={namespace} schoolId={schoolId} actorId={actorId} namespace={namespace}>{children}</DiningCommandRecoveryScope>;
}
function DiningCommandRecoveryScope({ schoolId, actorId, namespace, children }: { schoolId: string; actorId: string; namespace: string; children: ReactNode }) {
  const client = useQueryClient(), environment = useExecutionEnvironment(), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const key = useMemo(() => JSON.parse(namespace) as QueryKey, [namespace]);
  useEffect(() => { client.setQueryDefaults(key, { gcTime: Infinity }); }, [client, key]);
  const entries = useSyncExternalStore(useCallback(notify => client.getQueryCache().subscribe(notifyManager.batchCalls(notify)), [client]), useCallback(() => client.getQueryData<RetainedCommand[]>(key) ?? empty, [client, key]));
  const update = useCallback((map: (entries: RetainedCommand[]) => RetainedCommand[]) => client.setQueryData<RetainedCommand[]>(key, old => map(old ?? empty)), [client, key]);
  const retain = useCallback((entry: RetainedCommand) => { update(items => [...items.filter(item => item.commandId !== entry.commandId), entry]); }, [update]);
  const phase = useCallback((id: string, next: RetainedCommand["phase"]) => { update(items => items.map(item => item.commandId === id ? { ...item, phase: next } : item)); }, [update]);
  const detach = useCallback((id: string) => { update(items => items.map(item => item.commandId === id ? { ...item, detached: true } : item)); }, [update]);
  const clear = useCallback((id: string) => { update(items => items.filter(item => item.commandId !== id)); }, [update]);
  const registry = useMemo(() => ({ retain, phase, detach, clear }), [retain, phase, detach, clear]);
  const detached = entries.filter(item => item.detached), [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState("");
  useUnsavedChangesGuard(Boolean(detached.length), "A Dining action is still unconfirmed. Keep its exact result available for review.");
  const refreshSaved = async (entry: RetainedCommand) => {
    await client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["dining", schoolId, actorId]) }, { throwOnError: true });
    if (!active.current) return;
    await client.invalidateQueries({ queryKey: ["responsibility-workspace"] });
    if (!active.current) return;
    clear(entry.commandId); setMessage("The action was saved. Current access still controls which details you can open.");
  };
  const check = async (entry: RetainedCommand) => { setBusy(entry.commandId); setMessage(""); let saved = entry.phase === "accepted"; try {
    if (saved) { await refreshSaved(entry); return; }
    const result = await confirmDiningCommand(schoolId, entry.commandId, entry.sourceId);
    if (result.state === "accepted") {
      if (result.result?.id !== entry.sourceId || result.result.kind !== entry.kind || !Number.isInteger(result.result.revision) || result.result.revision < 1) throw new Error("This receipt belongs to another action. Keep this reference and check again.");
      saved = true; phase(entry.commandId, "accepted");
      if (active.current) await refreshSaved(entry);
    } else if (result.state === "not_accepted") { clear(entry.commandId); if (active.current) setMessage("The action was not accepted. Review the current record before starting again."); }
    else if (active.current) setMessage(result.state === "pending" ? "The action is still pending. Check again shortly." : "No accepted result was found yet. The exact reference is kept; no action is resent.");
  } catch (cause) { if (active.current) setMessage(saved ? "Saved. The updated view could not be loaded. Refresh the saved record." : cause instanceof Error ? cause.message : "The exact result could not be checked."); } finally { if (active.current) setBusy(null); } };
  return <RecoveryContext.Provider value={registry}>{detached.length ? <div className="dining-workspace"><section className="dining-warning" aria-label="Retained Dining action"><strong>{detached.some(item => item.phase === "accepted") ? "Saved action needs a refreshed view" : "A Dining action is not confirmed"}</strong><p>Its exact reference is kept. No private details or new action are shown here.</p>{detached.map(entry => <button key={entry.commandId} type="button" className="is-secondary" disabled={Boolean(busy) || entry.phase === "pending"} onClick={() => void check(entry)}>{entry.phase === "pending" ? "Waiting for result…" : busy === entry.commandId ? "Checking…" : entry.phase === "accepted" ? "Refresh saved record" : "Check exact result"}</button>)}</section></div> : null}{message ? <p className="dining-caption" role="status">{message}</p> : null}{children}</RecoveryContext.Provider>;
}
