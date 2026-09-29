import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarRange, ClipboardList, GraduationCap, History, Layers, Mail, Settings, Users } from "lucide-react";
import { useState } from "react";
import { Empty, PageTitle, Skeleton, Stat, Tabs, fmtDate } from "../components/ui";
import { administration } from "../features/administration";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Catalog } from "./administration/Catalog";
import { Imports } from "./administration/Imports";
import { People } from "./administration/People";
import { RecordForm } from "./administration/RecordForm";
import { Students } from "./administration/Students";

type Section = "setup" | "students" | "people" | "imports" | "audit" | "new";
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "setup", label: "Academic setup" }, { id: "students", label: "Students & guardians" }, { id: "people", label: "People & access" },
  { id: "imports", label: "Import & promotion" }, { id: "audit", label: "Audit" }, { id: "new", label: "New school" },
];

/* School administration is desktop-only: dense forms and directories that
   need a wide screen. Leadership opens on the school's shape, then works
   section by section. */
export function AdministrationPage() {
  const { school, selectSchool } = useAuth();
  const [section, setSection] = useState<Section>("setup");
  const query = useQuery({ queryKey: ["administration", school?.school_id], queryFn: () => administration(school!.school_id), enabled: Boolean(school) });

  if (!school) return <Empty>Select a school to manage its records.</Empty>;
  if (query.isPending) return <><Skeleton h={60} w={520} /><div className="grid4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={118} />)}</div><Skeleton h={420} /></>;
  if (query.error) return <div className="card" style={{ padding: 24 }}><Empty>{query.error.message}</Empty><div className="btnrow" style={{ justifyContent: "center" }}><button className="btn" onClick={() => void query.refetch()}>Retry</button></div></div>;

  const d = query.data;
  const props = { school: school.school_id, data: d, refresh: async () => { await query.refetch(); } };
  const activeTerm = d.terms.find((t) => t.is_active);
  const pendingInvites = d.invitations.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date()).length;
  const awaiting = d.students.filter((s) => s.onboarding_pending).length;

  return (
    <>
      <PageTitle
        icon={Settings}
        eyebrow={<>School administration<span className="sep" /><span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{d.school.code}</span></>}
        title={d.school.name}
        sub={activeTerm ? <>{activeTerm.name} · {activeTerm.academic_year} · attendance threshold {activeTerm.attendance_threshold}%</> : "No active term yet — start with Academic setup."}
        actions={<Tabs value={section} onChange={setSection} items={SECTIONS.map((s) => ({ id: s.id, label: s.label, count: s.id === "people" ? pendingInvites : s.id === "students" ? awaiting : undefined }))} />}
      />

      <div className="grid4">
        <Stat label="Students" icon={GraduationCap} value={d.students.length} tone={awaiting ? "cau" : "pos"} note={awaiting ? `${awaiting} awaiting invitation` : "all accounts ready"} />
        <Stat label="Classes" icon={Layers} iconKind="sec" value={d.classes.length} note={`${d.subjects.length} subject${d.subjects.length === 1 ? "" : "s"}`} />
        <Stat label="Terms" icon={CalendarRange} value={d.terms.length} tone={activeTerm ? "pos" : "cau"} note={activeTerm ? `${activeTerm.name} is active` : "none active"} />
        <Stat label="Members" icon={Users} value={d.members.filter((m) => m.is_active).length} tone={pendingInvites ? "inf" : undefined} note={pendingInvites ? `${pendingInvites} invitation${pendingInvites === 1 ? "" : "s"} pending` : "no pending invitations"} />
      </div>

      {section === "setup" ? <Catalog {...props} />
        : section === "students" ? <Students {...props} />
        : section === "people" ? <People {...props} />
        : section === "imports" ? <Imports {...props} />
        : section === "audit" ? (
          <div className="card">
            <div className="card-h"><b><History size={18} />Administrative changes</b><span className="aside">latest {d.audit.length}</span></div>
            {d.audit.length === 0 ? <Empty>No administrative changes recorded yet.</Empty> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>When</th><th>Action</th><th>By</th></tr></thead>
                <tbody>{d.audit.map((item) => <tr key={item.id}><td className="ink2">{fmtDate(item.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="mono">{item.action}</td><td>{item.first_name} {item.last_name}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
        ) : (
          <div className="grid12">
            <div className="col-5">
              <RecordForm icon={Building2} title="Provision a new school" submitLabel="Create school" fields={[
                { name: "name", label: "School name", wide: true }, { name: "code", label: "Unique code", hint: "Lowercase letters, digits and hyphens.", placeholder: "cambridge-intl" },
              ]} onSave={async (values) => {
                const result = await api<{ id: string }>("/api/v1/schools/", { method: "POST", body: JSON.stringify(values) });
                await selectSchool(result.id, "administration");
              }}>
                <p className="t-bsm ink2">You become its administrator. It starts empty: add a term, classes and students next.</p>
              </RecordForm>
            </div>
            <div className="col-7 panel tight">
              <div className="sec-h"><h2 className="ttl sm"><ClipboardList size={20} />Setting up a school</h2></div>
              <ol className="col xs" style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: "18px", color: "var(--ink-2)" }}>
                <li>Create the <b>term</b> with its dates and attendance threshold.</li>
                <li>Add <b>classes</b> for the same academic year, and the <b>subjects</b> taught.</li>
                <li>Add students one by one, or <b>import</b> a CSV — they are enrolled as they are created.</li>
                <li>Link <b>guardians</b>, then send each person a private <b>invitation code</b> so they can sign in.</li>
              </ol>
              <p className="t-bsm faint" style={{ display: "flex", alignItems: "center", gap: 6 }}><Mail size={14} />Nothing is emailed automatically; codes are shared by hand.</p>
            </div>
          </div>
        )}
    </>
  );
}
