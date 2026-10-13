import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getChatPolicy, updateChatPolicy } from "../chat/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";

const switches = [
  ["student_teacher_direct_enabled", "Students can message teachers"],
  ["guardian_teacher_direct_enabled", "Parents can message teachers"],
  ["student_group_replies", "Students can reply in groups"],
  ["guardian_group_replies", "Parents can reply in groups"],
  ["attachments_enabled", "Allow attachments"],
  ["enforce_communication_hours", "Restrict sending to communication hours"],
] as const;
const textValue = (data: FormData, key: string) => { const value = data.get(key); return typeof value === "string" ? value : ""; };

export function MessagingOperatingRules({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["chat", "policy", schoolId], queryFn: getChatPolicy });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (query.isPending) return <ScreenLoading/>;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch}/>;
  const rules = query.data;
  if (!rules.can_manage || rules.school_id !== schoolId) return <p role="alert">Switch to this institution with an administrator account to edit messaging rules.</p>;
  return <section className="office-panel"><h2>Messaging</h2>
    <form className="office-form" onSubmit={async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      setBusy(true); setMessage("");
      try {
        await updateChatPolicy({ ...Object.fromEntries(switches.map(([key]) => [key, data.has(key)])), communication_start: textValue(data, "start"), communication_end: textValue(data, "end"), retention_days: Number(data.get("retention")) });
        await client.invalidateQueries({ queryKey: ["chat", "policy"] });
        setMessage("Operating rules saved.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Rules could not be saved."); }
      finally { setBusy(false); }
    }}>
      {switches.map(([key, label]) => <label key={key}><input type="checkbox" name={key} defaultChecked={rules[key]}/> {label}</label>)}
      <div className="office-form-grid">
        <label className="office-field">Start time<input name="start" type="time" required defaultValue={rules.communication_start.slice(0, 5)}/></label>
        <label className="office-field">End time<input name="end" type="time" required defaultValue={rules.communication_end.slice(0, 5)}/></label>
        <label className="office-field">Retention (days)<input name="retention" type="number" min={30} max={3650} required defaultValue={rules.retention_days}/></label>
      </div>
      <p className="office-hint">These rules apply to school messaging, not the AI assistant. Access checks and reporting safeguards remain enforced.</p>
      <button className="office-primary" disabled={busy}>{busy ? "Saving…" : "Save rules"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  </section>;
}
