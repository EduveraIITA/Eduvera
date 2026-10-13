import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";

type Rules = { revision: number; attendance_submission_cutoff: string; event_entry_hours_before: number; event_staff_hours_after: number; journey_lead_minutes: number; message_edit_minutes: number; message_attachment_mb: number };
const fields = {
  attendance: [["attendance_submission_cutoff", "Register submission deadline", "time", 0, 0]],
  events: [["event_entry_hours_before", "Open entry before session (hours)", "number", 0, 168], ["event_staff_hours_after", "Staff entry and locking after session (hours)", "number", 0, 720]],
  departure: [["journey_lead_minutes", "Open boarding before departure (minutes)", "number", 0, 240]],
  messages: [["message_edit_minutes", "Allow editing after sending (minutes)", "number", 0, 60], ["message_attachment_mb", "Maximum attachment size (MB)", "number", 1, 10]],
} as const;
const copy = {
  attendance: "Registers become overdue after this time in the institution’s timezone. This does not mark missing students absent.",
  events: "Applies to all event sessions. Administrators can correct older open registers; recorded observation times still follow the observation window.",
  departure: "Journey controls open at this lead time; routine duty changes close at the same time. Rider reconciliation remains required.",
  messages: "Set editing to zero to disable it. File types and the platform’s 10 MB ceiling remain enforced.",
};
export function WorkflowRules({ schoolId, category }: { schoolId: string; category: keyof typeof fields }) {
  const client = useQueryClient();
  const url = `/api/v1/operating-rules/${schoolId}`;
  const query = useQuery({ queryKey: ["workflow-rules", schoolId], queryFn: () => apiFetch<Rules>(url) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (query.isPending) return <ScreenLoading/>;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch}/>;
  return <section className="office-panel"><h2>{category === "attendance" ? "Daily attendance" : "Operating windows"}</h2>
    <p className="office-hint">{copy[category]}</p>
    <form className="office-form" key={query.data.revision} onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const { revision, ...values } = query.data;
      const updates = Object.fromEntries(fields[category].map(([key,,type]) => { const value = form.get(key); return [key, type === "time" ? value : Number(value)]; }));
      setBusy(true); setMessage("");
      try {
        await apiFetch<Rules>(url, { method: "POST", body: JSON.stringify({ ...values, ...updates, expected_revision: revision }) });
        await client.invalidateQueries(); setMessage("Operating rules saved.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Rules could not be saved."); }
      finally { setBusy(false); }
    }}>
      <div className="office-form-grid">{fields[category].map(([key,label,type,min,max]) => <label className="office-field" key={key}>{label}<input name={key} type={type} required step={type === "number" ? 1 : undefined} min={type === "number" ? min : undefined} max={type === "number" ? max : undefined} defaultValue={query.data[key]}/></label>)}</div>
      <p className="office-hint">Changes apply immediately, including existing open workflows. Historical records stay unchanged.</p>
      <button className="office-primary" disabled={busy}>{busy ? "Saving…" : "Save rules"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  </section>;
}
