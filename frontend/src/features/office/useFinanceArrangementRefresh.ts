import { useEffect, useRef, useState } from "react";
import { getFinanceArrangements, type FinanceArrangementsWorkspace } from "./financeArrangementsApi";

/** Refresh only the mounted actor/world/source instance. This does not confirm
 * an uncertain write; callers use it only after permanent non-acceptance. */
export function useFinanceArrangementRefresh(schoolId: string, studentId: string | null, invoiceId: string,
  onRefreshed: (workspace: FinanceArrangementsWorkspace) => void, personId?: string | null) {
  const active = useRef(true), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const workspace = personId ? await getFinanceArrangements(schoolId, undefined, invoiceId, undefined, personId) : await getFinanceArrangements(schoolId, studentId, invoiceId);
      if (active.current) onRefreshed(workspace);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Couldn’t refresh this fee account."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  return { busy, error, refresh };
}
