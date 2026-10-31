import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";

type WriteIdentity = { sourceId: string; revision: number; fingerprint: string };
type Recovery = "none" | "unknown" | "accepted" | "obsolete";
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Retain the exact command and its inputs until its outcome is known. */
export function useTeachingSessionWrite(refresh: () => Promise<unknown>, onAccessLost?: () => void) {
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [error, setError] = useState("");
  const [recovery, setRecovery] = useState<Recovery>("none");
  const active = useRef(true), pending = useRef(false);
  const retained = useRef<{ key: string; retry: () => Promise<boolean> } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function run<T>(key: string, operation: (commandId: string) => Promise<T>, identity: WriteIdentity, accepted?: (result: T) => void) {
    if (pending.current || !active.current) return false;
    if (retained.current) return retained.current.key === key ? retained.current.retry() : false;
    const commandId = crypto.randomUUID();
    let saved = false, wasUnknown = false;
    const execute = async (): Promise<boolean> => {
      if (pending.current || !active.current) return false;
      pending.current = true; setBusy(true); setError("");
      try {
        if (!saved) {
          const result = await operation(commandId); saved = true;
          if (!active.current) return false;
          accepted?.(result);
        }
        await refresh();
        if (active.current) { retained.current = null; setLocked(false); setRecovery("none"); }
        return true;
      } catch (cause) {
        if (!active.current) return false;
        if (cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status)) {
          retained.current = null; setLocked(true); setRecovery("none"); setError("Your access to this session changed. Refresh your current responsibilities before continuing."); onAccessLost?.(); return false;
        }
        const fields = object(object(object(cause instanceof ApiError ? cause.details : null)?.error)?.fields);
        const proof = object(fields?.lesson_obsolete);
        const obsolete = !saved && cause instanceof ApiError && cause.status === 409
          && proof?.confirmation === "permanently_inapplicable"
          && proof.handler === "learning.sessions"
          && proof.command_id === commandId && proof.source_id === identity.sourceId && proof.expected_revision === identity.revision
          && (proof.code === "learning.session_revision_obsolete" && proof.receipt_state === "absent" && typeof proof.current_revision === "number" && Number.isInteger(proof.current_revision) && proof.current_revision > identity.revision
            || proof.code === "learning.session_source_changed" && proof.receipt_state === "conflicted" && proof.reviewed_source_fingerprint === identity.fingerprint && typeof proof.current_source_fingerprint === "string" && proof.current_source_fingerprint !== identity.fingerprint);
        if (obsolete) {
          retained.current = null; setLocked(true); setRecovery("obsolete");
          setError("This lesson changed. Your text is kept. Review the saved version before continuing.");
          return false;
        }
        const uncertain = saved || wasUnknown || !(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400;
        wasUnknown ||= uncertain;
        setLocked(uncertain); setRecovery(saved ? "accepted" : uncertain ? "unknown" : "none");
        setError(saved ? "Saved. The updated view could not load. Refresh the saved session before continuing."
          : `${cause instanceof Error ? cause.message : "The action was not confirmed."}${uncertain ? " Keep this screen and retry the same action." : ""}`);
        if (!uncertain) retained.current = null;
        return false;
      } finally { pending.current = false; if (active.current) setBusy(false); }
    };
    retained.current = { key, retry: execute };
    return execute();
  }
  async function recover() { if (!pending.current && retained.current) return retained.current.retry(); return false; }
  function resolveObsolete() { if (recovery === "obsolete" && !pending.current) { setLocked(false); setRecovery("none"); setError(""); } }
  return { busy, locked, error, recovery, run, recover, resolveObsolete };
}
