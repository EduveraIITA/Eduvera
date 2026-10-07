import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useState } from "react";
import { ScreenLoading, LiveRouteError } from "../school/LiveRouteState";
import { deleteProfile, getRoles, type WorkProfile } from "./api";
import { RoleEditor } from "./RoleEditor";
import "../office/office.css";
import "./roles.css";

export function RoleSetupPanel({ school, onChanged }: { school: string; onChanged?: () => Promise<void> }) {
  const [editor, setEditor] = useState<WorkProfile | null | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["roles", school], queryFn: () => getRoles(school), enabled: Boolean(school), refetchOnWindowFocus: true });

  async function refresh() {
    await query.refetch();
    await onChanged?.();
  }

  async function remove(role: WorkProfile) {
    setBusy(role.id);
    setError("");
    try {
      await deleteProfile(school, role);
      await refresh();
      setNotice(`${role.name} deleted.`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!school) return <p className="office-alert">An active institution administrator membership is required.</p>;
  if (query.isPending) return <ScreenLoading />;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch} />;

  const data = query.data;
  return <section className="roles-page" aria-labelledby="staff-roles-title">
    {notice ? <p className="roles-success" role="status">{notice}</p> : null}
    {error ? <p className="office-alert" role="alert">{error}</p> : null}
    {editor !== undefined ? <RoleEditor
      key={`${school}:${editor?.id ?? "new"}`}
      school={school}
      profile={editor}
      templates={data.templates}
      duties={data.duties}
      onCancel={() => setEditor(undefined)}
      onSaved={async () => {
        await refresh();
        setEditor(undefined);
        setNotice("Role saved.");
      }}
    /> : <>
      <header className="roles-simple-heading">
        <div>
          <span className="roles-eyebrow">ROLES</span>
          <h2 id="staff-roles-title">What can each role do?</h2>
          <p>Choose responsibilities. The app adds the required access automatically.</p>
        </div>
        <button className="office-primary" onClick={() => { setEditor(null); setNotice(""); }}><Plus size={17} /> New role</button>
      </header>
      {!data.profiles.length ? <div className="office-panel roles-empty"><h3>No roles yet</h3><p>Create a role before assigning staff responsibilities.</p><button className="office-secondary" onClick={() => setEditor(null)}>Create role</button></div> : <div className="roles-list">{data.profiles.map((role) => {
        const responsibilities = data.duties.filter((duty) => role.duty_ids.includes(duty.id));
        return <article className="office-panel roles-card" key={role.id}>
          <div className="roles-card-mark" aria-hidden="true"><ShieldCheck size={20} /></div>
          <div className="roles-card-copy">
            <h3>{role.name}</h3>
            {role.description ? <p>{role.description}</p> : null}
            <div className="roles-duty-chips">{responsibilities.slice(0, 4).map((duty) => <span key={duty.id}>{duty.name}</span>)}{responsibilities.length > 4 ? <span>+{responsibilities.length - 4}</span> : null}</div>
            <small>{responsibilities.length} {responsibilities.length === 1 ? "responsibility" : "responsibilities"} · {role.member_count} {role.member_count === 1 ? "person" : "people"}</small>
          </div>
          <div className="roles-card-actions">
            <button className="office-secondary" onClick={() => setEditor(role)} aria-label={`Edit ${role.name}`}><Pencil size={16} /><span>Edit</span></button>
            <button className="office-secondary" disabled={Boolean(busy) || role.member_count > 0} title={role.member_count ? "Move staff to another role before deleting" : "Delete unused role"} onClick={() => void remove(role)} aria-label={`Delete ${role.name}`}><Trash2 size={16} /></button>
          </div>
        </article>;
      })}</div>}
    </>}
  </section>;
}

export default function RolesRedirect() {
  return <Navigate to="/principal/staff?section=roles" replace />;
}
