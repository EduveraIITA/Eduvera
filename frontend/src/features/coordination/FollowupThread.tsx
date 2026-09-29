import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addFollowupEntry, getFollowup, type FollowupContext, type FollowupDetail, type FollowupEntryInput } from "./api";

const moment = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const outcomeLabels = { absence_explained: "Absence explained", record_corrected: "Attendance record corrected", query_withdrawn: "Query withdrawn" };
export function FollowupThread({ id, context }: { id: string; context: FollowupContext }) {
  const query = useQuery({ queryKey: ["school", "coordination", "detail", context, id], queryFn: () => getFollowup(id, context) });
  if (query.isPending) return <p role="status">Loading conversation…</p>;
  if (query.isError) return <div className="followup-error" role="alert"><p>Could not load this follow-up.</p><button onClick={() => void query.refetch()}>Try again</button></div>;
  return <div className="followup-thread">
    <p className="followup-meta">Response due {moment(query.data.due_at)}</p>
    <ol>{query.data.entries.map((entry) => <li key={entry.id}>
      <div><strong>{entry.actor_name}</strong><time dateTime={entry.recorded_at}>{moment(entry.recorded_at)}</time></div>
      {entry.kind === "assisted_reply" ? <small>Recorded by staff · {entry.channel.replace("_", " ")} response from {entry.guardian_name} · Received {moment(entry.observed_at)}</small> : null}
      {entry.kind === "resolved" ? <small>Recorded outcome</small> : null}<p>{entry.body}</p>
    </li>)}</ol>
    {query.data.state === "resolved" ? <p className="followup-confirmation">{query.data.outcome ? outcomeLabels[query.data.outcome] : "Resolved"}</p>
      : <ResponseForm key={query.data.id} data={query.data} context={context} onRefresh={() => void query.refetch()} />}
  </div>;
}

function ResponseForm({ data, context, onRefresh }: { data: FollowupDetail; context: FollowupContext; onRefresh: () => void }) {
  const cache = useQueryClient();
  const [kind, setKind] = useState<FollowupEntryInput["kind"]>(context === "guardian" ? "guardian_reply" : "assisted_reply");
  const [body, setBody] = useState("");
  const [guardian, setGuardian] = useState(data.guardians[0]?.id ?? "");
  const [channel, setChannel] = useState<"phone" | "paper" | "in_person">("phone");
  const [observedAt, setObservedAt] = useState("");
  const [outcome, setOutcome] = useState<NonNullable<FollowupDetail["outcome"]>>("absence_explained");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setSaved("");
    try {
      const input = { context, kind, body, expected_revision: data.revision,
        ...(kind === "assisted_reply" ? { guardian_id: guardian, channel, observed_at: new Date(observedAt).toISOString() } : {}),
        ...(kind === "resolved" ? { outcome } : {}),
      };
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.body !== fingerprint) attempt.current = { body: fingerprint, id: crypto.randomUUID() };
      await addFollowupEntry(data.id, { ...input, idempotency_key: attempt.current.id });
      setBody(""); setSaved(kind === "resolved" ? "Outcome recorded." : "Response saved. Awaiting school review."); attempt.current = null;
      await cache.invalidateQueries({ queryKey: ["school", "coordination"] });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the response. Your text is still here."); }
    finally { setBusy(false); }
  };
  return <form className="followup-form" onSubmit={(event) => void submit(event)}>
    {context === "staff" && data.can_resolve ? <label>Next action<select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="assisted_reply">Record a guardian response</option><option value="resolved">Record outcome & resolve</option></select></label> : null}
    {kind === "assisted_reply" ? <div className="followup-form__grid">
      <label>Guardian<select required value={guardian} onChange={(event) => setGuardian(event.target.value)}><option value="">Select guardian</option>{data.guardians.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>Contact method<select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="phone">Phone call</option><option value="paper">Paper response</option><option value="in_person">In person</option></select></label>
      <label>Response received at<input type="datetime-local" required value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></label>
    </div> : null}
    {kind === "resolved" ? <label>Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
    <label>{kind === "resolved" ? "Outcome details" : "Your response"}<textarea required minLength={3} maxLength={1000} rows={3} value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <p className="followup-meta">Shared with linked guardians and assigned school staff. For confidential concerns, contact the school directly.</p>
    {error ? <div role="alert" className="followup-error">{error} <button type="button" onClick={onRefresh}>Refresh follow-up</button></div> : null}
    {saved ? <p role="status" className="followup-confirmation">{saved}</p> : null}
    <button className="followup-primary" type="submit" disabled={busy || body.trim().length < 3}>{busy ? "Saving…" : kind === "resolved" ? "Record outcome & resolve" : context === "guardian" ? "Send response" : "Save response"}</button>
  </form>;
}
