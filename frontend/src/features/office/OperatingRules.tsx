import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { getStaffWorkspace } from "../staff-operations/api";
import { getDepartureWorkspace, saveDeparturePolicy } from "../departure/api";
import { CoverageOperatingRules } from "./CoverageOperatingRules";
import { DepartureRulesForm } from "./DepartureRulesForm";
import { MessagingOperatingRules } from "./MessagingOperatingRules";
import { WorkflowRules } from "./WorkflowRules";
import { getEventObservationPolicy, saveEventObservationPolicy } from "../campus-events/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";

export function OperatingRules({ schoolId }: { schoolId: string }) {
  const [params] = useSearchParams();
  const rule = params.get("rule");
  const base = `?school=${encodeURIComponent(schoolId)}&section=rules`;
  const categories = [
    ["attendance", "Daily attendance", "Submission deadline and overdue attention"],
    ["events", "Event attendance", "Observation windows for every event register"],
    ["coverage", "Leave cover", "Deadlines and automatic fallback decisions"],
    ["departure", "Departure & transport", "Allowed arrangements, cutoff and location handling"],
    ["messages", "Messaging", "Who can message, communication hours and retention"],
  ];
  if (!categories.some(([id]) => id === rule)) return <>
    <p className="office-hint">How the app operates across your institution.</p>
    <nav className="more-grid more-grid--list" aria-label="Operating rule categories">{categories.map(([id, title]) => <Link className="more-tile more-tile--text-only" key={id} to={`${base}&rule=${id}`}><span className="more-tile__copy"><strong>{title}</strong></span><ChevronRight className="more-tile__chevron" size={18} aria-hidden="true"/></Link>)}</nav>
  </>;
  return <>
    {rule === "attendance" ? <WorkflowRules schoolId={schoolId} category="attendance"/> : rule === "events" ? <EventRules schoolId={schoolId}/> : rule === "coverage" ? <CoverageRules schoolId={schoolId}/> : rule === "departure" ? <DepartureRules schoolId={schoolId}/> : <MessagingOperatingRules schoolId={schoolId}/>}
    {rule === "events" || rule === "departure" || rule === "messages" ? <WorkflowRules key={rule} schoolId={schoolId} category={rule}/> : null}
  </>;
}

function CoverageRules({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["operating-rules", schoolId, "coverage"], queryFn: () => getStaffWorkspace(schoolId) });
  if (query.isPending) return <ScreenLoading/>;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch}/>;
  if (query.data.mode !== "admin") return <p role="alert">Administrator access is required.</p>;
  return <CoverageOperatingRules key={query.data.coverage_policy?.revision ?? 0} schoolId={schoolId} data={query.data} refresh={async () => { await query.refetch(); await client.invalidateQueries(); }}/>;
}

function DepartureRules({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["operating-rules", schoolId, "departure"], queryFn: () => getDepartureWorkspace(schoolId) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (query.isPending) return <ScreenLoading/>;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch}/>;
  return <section className="office-panel"><h2>Departure & transport</h2><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}><DepartureRulesForm key={query.data.policy.revision} data={query.data} submit={async payload => {
    setBusy(true); setMessage("");
    try { await saveDeparturePolicy(schoolId, payload); await client.invalidateQueries(); setMessage("Operating rules saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Rules could not be saved."); }
    finally { setBusy(false); }
  }}/></fieldset>{message ? <p role="status">{message}</p> : null}</section>;
}

function EventRules({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["operating-rules", schoolId], queryFn: () => getEventObservationPolicy(schoolId) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (query.isPending) return <ScreenLoading />;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const rules = query.data;
  return <>
    <section className="office-panel">
      <h2>Event attendance</h2>
      <p className="office-hint">Allow observations within this window around each session. The time attendance was observed is separate from when the register is submitted.</p>
      <form key={`${schoolId}-${rules.revision}`} className="office-form" onSubmit={async event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true); setMessage("");
        try {
          await saveEventObservationPolicy(schoolId, { observation_hours_before: Number(data.get("before")), observation_hours_after: Number(data.get("after")), expected_revision: rules.revision });
          await query.refetch();
          await client.invalidateQueries({ queryKey: ["campus-event-register"] });
          setMessage("Operating rules saved.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Rules could not be saved."); }
        finally { setBusy(false); }
      }}>
        <div className="office-form-grid">
          <label className="office-field">Hours before the session<input name="before" type="number" required min="0" max="168" step="1" defaultValue={rules.observation_hours_before} /></label>
          <label className="office-field">Hours after the session<input name="after" type="number" required min="0" max="168" step="1" defaultValue={rules.observation_hours_after} /></label>
        </div>
        <p className="office-hint">Applies immediately to future entries and corrections. Existing records stay unchanged.</p>
        <button className="office-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save rules"}</button>
        {message ? <p role="status" className="office-hint">{message}</p> : null}
      </form>
    </section>
  </>;
}
