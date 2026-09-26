import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageTitle } from "../components/ui";
import { administration } from "../features/administration";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Catalog } from "./administration/Catalog";
import { Imports } from "./administration/Imports";
import { People } from "./administration/People";
import { RecordForm } from "./administration/RecordForm";
import { Students } from "./administration/Students";
import "./administration/administration.css";

export function AdministrationPage() {
  const { school, selectSchool } = useAuth();
  const [tab, setTab] = useState("Academic setup");
  const query = useQuery({ queryKey: ["administration", school?.school_id], queryFn: () => administration(school!.school_id), enabled: Boolean(school) });
  if (!school) return <p>Select a school to manage its records.</p>;
  if (query.isPending) return <p role="status">Loading school records…</p>;
  if (query.error) return <div role="alert"><p>{query.error.message}</p><button className="btn" onClick={() => void query.refetch()}>Retry</button></div>;
  const props = { school: school.school_id, data: query.data, refresh: async () => { await query.refetch(); } };
  return <><PageTitle eyebrow="School administration" title={query.data.school.name} sub="Manage records, academic structure and school access." />
    <nav className="ops-tabs" aria-label="Administration sections">{["Academic setup", "Students & guardians", "People & access", "Import & promotion", "Audit", "New school"].map((item) => <button key={item} className="btn" aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "Academic setup" ? <Catalog {...props} /> : tab === "Students & guardians" ? <Students {...props} /> : tab === "People & access" ? <People {...props} /> : tab === "Import & promotion" ? <Imports {...props} /> : tab === "Audit" ? <section className="card ops-panel"><h2>Latest administrative changes</h2><div className="ops-table"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th></tr></thead><tbody>{query.data.audit.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.action}</td><td>{item.first_name} {item.last_name}</td></tr>)}</tbody></table>{!query.data.audit.length ? <p>No administrative changes recorded yet.</p> : null}</div></section> :
      <RecordForm title="Provision a school" fields={[{ name: "name", label: "School name" }, { name: "code", label: "Unique code (lowercase letters, digits and hyphens)" }]} onSave={async (values) => {
        const result = await api<{ id: string }>("/api/v1/schools/", { method: "POST", body: JSON.stringify(values) }); await selectSchool(result.id, "administration");
      }}><p>You become the administrator of the new school. Its records start empty; add a term, classes and students next.</p></RecordForm>}
  </>;
}
