import { useQuery } from "@tanstack/react-query";
import { PageTitle } from "../components/ui";
import { api } from "../lib/api";
import { RecordForm } from "./administration/RecordForm";
import "./administration/administration.css";

export function SecurityPage() {
  const query = useQuery({ queryKey: ["sessions"], queryFn: () => api<{ results: Array<{ current: boolean; user_agent: string; last_seen_at: string; expires_at: string }> }>("/api/v1/auth/sessions/") });
  return <><PageTitle title="Account sessions" sub="Review active browsers and sign out other sessions." />
    {query.isPending ? <p role="status">Loading sessions…</p> : query.error ? <p role="alert">{query.error.message}</p> : <section className="card ops-panel"><h2>Active sessions</h2>{query.data.results.map((item, index) => <p className="ops-code" key={index}>{item.current ? "This browser · " : "Other browser · "}{item.user_agent || "Unknown browser"}<br />Last active: {new Date(item.last_seen_at).toLocaleString()}</p>)}</section>}
    <RecordForm title="Sign out other browsers" fields={[]} submitLabel="Revoke other sessions" onSave={async () => { await api("/api/v1/auth/sessions/revoke-others/", { method: "POST" }); await query.refetch(); }} />
  </>;
}
