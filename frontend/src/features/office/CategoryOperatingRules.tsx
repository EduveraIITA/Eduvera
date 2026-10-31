import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";

import { TemporalInput } from "../../components/forms/TemporalInput";
import { InfoSummary } from "../../components/InfoSummary";
type Category = "events" | "departure" | "messages";
type WorkflowRules = {
  revision: number;
  event_entry_hours_before: number;
  event_staff_hours_after: number;
  journey_lead_minutes: number;
  message_edit_minutes: number;
  message_attachment_mb: number;
  attendance_submission_cutoff: string;
};
type DomainRules = Record<string, string | number | boolean | string[]> & { revision: number };
type CategoryRules = { category: Category; workflow: WorkflowRules; domain: DomainRules };

const titles = {
  events: ["Event attendance", "When staff may record and correct event attendance."],
  departure: ["Departure & transport", "How departure changes, journey controls and location freshness work."],
  messages: ["Messaging", "Who can communicate and when."],
} as const;
const departureModes = [
  ["guardian_pickup", "Guardian pickup"],
  ["authorized_collector", "Authorized collector"],
  ["independent_departure", "Independent departure"],
  ["school_transport", "School transport"],
  ["external_transport", "External transport"],
] as const;
const messageSwitches = [
  ["student_teacher_direct_enabled", "Students can message teachers"],
  ["guardian_teacher_direct_enabled", "Parents can message teachers"],
  ["student_group_replies", "Students can reply in groups"],
  ["guardian_group_replies", "Parents can reply in groups"],
  ["attachments_enabled", "Allow attachments"],
  ["enforce_communication_hours", "Restrict sending to communication hours"],
] as const;

const numberValue = (form: FormData, key: string) => Number(form.get(key));
const textValue = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

function payload(category: Category, rules: CategoryRules, form: FormData) {
  const revisions = {
    expected_workflow_revision: rules.workflow.revision,
    expected_domain_revision: rules.domain.revision,
  };
  if (category === "events") return {
    ...revisions,
    event_entry_hours_before: numberValue(form, "event_entry_hours_before"),
    event_staff_hours_after: numberValue(form, "event_staff_hours_after"),
    observation_hours_before: numberValue(form, "observation_hours_before"),
    observation_hours_after: numberValue(form, "observation_hours_after"),
  };
  if (category === "departure") return {
    ...revisions,
    journey_lead_minutes: numberValue(form, "journey_lead_minutes"),
    enabled: form.has("enabled"),
    enabled_modes: form.getAll("enabled_modes").map(String),
    change_cutoff: textValue(form, "change_cutoff"),
    location_retention_hours: numberValue(form, "location_retention_hours"),
    location_stale_seconds: numberValue(form, "location_stale_seconds"),
  };
  return {
    ...revisions,
    message_edit_minutes: numberValue(form, "message_edit_minutes"),
    message_attachment_mb: numberValue(form, "message_attachment_mb"),
    ...Object.fromEntries(messageSwitches.map(([key]) => [key, form.has(key)])),
    communication_start: textValue(form, "communication_start"),
    communication_end: textValue(form, "communication_end"),
  };
}

export function CategoryOperatingRules({ schoolId, category, onDirtyChange }: { schoolId: string; category: Category; onDirtyChange: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const url = `/api/v1/operating-rules/${schoolId}/categories/${category}`;
  const query = useQuery({ queryKey: ["operating-rules", schoolId, category], queryFn: () => apiFetch<CategoryRules>(url) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const scope = `${schoolId}:${category}`;
  const [editSnapshot, setEditSnapshot] = useState<{ scope: string; rules: CategoryRules } | null>(null);
  const editBase = editSnapshot?.scope === scope ? editSnapshot.rules : null;
  const rules = editBase ?? query.data;
  if (!rules && query.isPending) return <ScreenLoading />;
  if (!rules && query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  if (!rules) return <ScreenLoading />;
  const changedElsewhere = editBase && query.data && (
    editBase.workflow.revision !== query.data.workflow.revision || editBase.domain.revision !== query.data.domain.revision
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const saved = await apiFetch<CategoryRules>(url, { method: "POST", body: JSON.stringify(payload(category, rules, new FormData(event.currentTarget))) });
      client.setQueryData(["operating-rules", schoolId, category], saved);
      setEditSnapshot(null);
      onDirtyChange(false);
      await client.invalidateQueries();
      setMessage("Operating rules saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rules could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return <section className="office-panel operating-category">
    <h2>{titles[category][0]}</h2>
    <p className="office-hint">{titles[category][1]}</p>
    <form className="office-form" key={`${scope}:${rules.workflow.revision}:${rules.domain.revision}`} onChange={() => { setEditSnapshot(base => base?.scope === scope ? base : { scope, rules }); onDirtyChange(true); }} onSubmit={(event) => void submit(event)}>
      <fieldset className="operating-category__fields" disabled={busy}>
      {category === "events" ? <EventFields rules={rules} /> : category === "departure" ? <DepartureFields rules={rules} /> : <MessageFields rules={rules} />}
      </fieldset>
      {query.isError ? <p role="alert">Latest rules could not be refreshed. Your edits are kept.</p> : null}
      {changedElsewhere ? <p role="status">Rules changed elsewhere. Your edits are kept; reload before saving.</p> : null}
      {editBase ? <button type="button" className="office-secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const latest = await query.refetch();
          if (latest.isError || !latest.data) { setMessage("Rules could not be reloaded. Your edits are kept."); return; }
          setEditSnapshot(null); onDirtyChange(false); setMessage("");
        } finally { setBusy(false); }
      }}>Discard edits and reload</button> : null}
      <p className="office-hint">Changes apply together after validation. Existing historical records stay unchanged.</p>
      <button className="office-primary" disabled={busy || Boolean(changedElsewhere)}>{busy ? "Saving…" : "Save changes"}</button>
      {message ? <p role="status" className="office-hint">{message}</p> : null}
    </form>
  </section>;
}

function EventFields({ rules }: { rules: CategoryRules }) {
  return <div className="office-form-grid">
    <label className="office-field">Open register before session (hours)<input name="event_entry_hours_before" type="number" required min="0" max="168" defaultValue={rules.workflow.event_entry_hours_before}/></label>
    <label className="office-field">Staff access after session (hours)<input name="event_staff_hours_after" type="number" required min="0" max="720" defaultValue={rules.workflow.event_staff_hours_after}/></label>
    <label className="office-field">Observation before session (hours)<input name="observation_hours_before" type="number" required min="0" max="168" defaultValue={Number(rules.domain.observation_hours_before)}/></label>
    <label className="office-field">Observation after session (hours)<input name="observation_hours_after" type="number" required min="0" max="168" defaultValue={Number(rules.domain.observation_hours_after)}/></label>
  </div>;
}

function DepartureFields({ rules }: { rules: CategoryRules }) {
  const modes = Array.isArray(rules.domain.enabled_modes) ? rules.domain.enabled_modes : [];
  return <>
    <label className="departure-check"><input name="enabled" type="checkbox" defaultChecked={Boolean(rules.domain.enabled)}/> Enable controlled departure</label>
    <fieldset className="departure-mode-options departure-span"><legend>Allowed arrangements</legend>{departureModes.map(([value, label]) => <label key={value}><input type="checkbox" name="enabled_modes" value={value} defaultChecked={modes.includes(value)}/>{label}</label>)}</fieldset>
    <div className="office-form-grid">
      <label className="office-field">Open journey controls before departure (minutes)<input name="journey_lead_minutes" type="number" required min="0" max="240" defaultValue={rules.workflow.journey_lead_minutes}/></label>
      <label className="office-field">Same-day change cutoff<TemporalInput name="change_cutoff" type="time" required defaultValue={String(rules.domain.change_cutoff).slice(0, 5)}/></label>
      <label className="office-field">Location retention (hours)<input name="location_retention_hours" type="number" required min="1" max="168" defaultValue={Number(rules.domain.location_retention_hours)}/></label>
      <label className="office-field">Location becomes stale (seconds)<input name="location_stale_seconds" type="number" required min="30" max="600" defaultValue={Number(rules.domain.location_stale_seconds)}/></label>
    </div>
  </>;
}

function MessageFields({ rules }: { rules: CategoryRules }) {
  return <>
    <div className="operating-category__switches">{messageSwitches.map(([key, label]) => <label key={key}><input type="checkbox" name={key} defaultChecked={Boolean(rules.domain[key])}/><span>{label}</span></label>)}</div>
    <div className="office-form-grid">
      <label className="office-field">Communication starts<TemporalInput name="communication_start" type="time" required defaultValue={String(rules.domain.communication_start).slice(0, 5)}/></label>
      <label className="office-field">Communication ends<TemporalInput name="communication_end" type="time" required defaultValue={String(rules.domain.communication_end).slice(0, 5)}/></label>
      <label className="office-field">Message editing (minutes)<input name="message_edit_minutes" type="number" required min="0" max="60" defaultValue={rules.workflow.message_edit_minutes}/></label>
      <label className="office-field">Maximum attachment size (MB)<input name="message_attachment_mb" type="number" required min="1" max="10" defaultValue={rules.workflow.message_attachment_mb}/></label>
    </div>
    <details className="office-hint"><InfoSummary>Hours & privacy</InfoSummary>
      <p>Times use {String(rules.domain.timezone)}. Overnight ranges cross midnight; equal start and end times allow all day. Reading and reporting stay available outside these hours.</p>
      <p>Automatic message deletion is not enabled.</p>
    </details>
  </>;
}
