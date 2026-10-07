import { GraduationCap, Link2, Search, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Empty, Initials, Pill, Status } from "../../components/ui";
import { type Administration, type Student, fullName, save } from "../../features/administration";
import { RecordForm, type Field } from "./RecordForm";

const personFields: Field[] = [{ name: "first_name", label: "First name" }, { name: "last_name", label: "Last name" }, { name: "email", label: "Email", type: "email" }];

/* Students & guardians: the directory on the right is the source of truth;
   forms on the left add to it. A student cannot sign in until invited. */
export function Students({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<Student | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(25);
  const classes = data.classes.map((item) => ({ value: item.id, label: `Class ${item.grade}${item.section} · ${item.academic_year}` }));
  const terms = data.terms.filter((item) => item.is_active).map((item) => ({ value: item.id, label: `${item.name} · ${item.academic_year}` }));
  const enrollmentFields: Field[] = [
    { name: "class_section_id", label: "Class", options: classes }, { name: "term_id", label: "Term", options: terms },
    { name: "roll_number", label: "Roll number", type: "number", min: 1, max: 32767 },
  ];
  const fields: Field[] = [
    ...personFields.filter((field) => !editing || field.name !== "email"),
    { name: "admission_number", label: "Admission number", placeholder: "CIS-2026-0101" }, { name: "date_of_birth", label: "Date of birth", type: "date", optional: true },
    ...(!editing ? enrollmentFields : []),
  ];
  const q = search.trim().toLowerCase();
  const visible = data.students.filter((item) => `${fullName(item)} ${item.admission_number} ${item.email}`.toLowerCase().includes(q));
  const pending = data.students.filter((s) => s.onboarding_pending).length;
  const enrolledIn = (id: string) => {
    const e = data.enrollments.find((x) => x.student_id === id);
    const c = e && data.classes.find((x) => x.id === e.class_section_id);
    return c && e ? `Class ${c.grade}${c.section} · roll ${e.roll_number}` : null;
  };
  const studentOptions = data.students.map((item) => ({ value: item.id, label: `${fullName(item)} · ${item.admission_number}` }));

  return (
    <div className="col">
      <div className="grid12">
        <div className="col-5 col">
          <RecordForm key={editing?.id ?? "new"} icon={editing ? GraduationCap : UserPlus} title={editing ? `Edit ${fullName(editing)}` : "Add student and enrol"}
            fields={fields.map((field) => ({ ...field, value: editing ? String((editing as unknown as Record<string, unknown>)[field.name] ?? "") : field.value }))}
            onCancel={editing ? () => setEditing(null) : undefined}
            onSave={async (values) => {
              await save(school, `students${editing ? `/${editing.id}` : ""}`, { ...values, date_of_birth: values.date_of_birth || null, ...(!editing ? { roll_number: Number(values.roll_number) } : {}) }, editing ? "PATCH" : "POST");
              await refresh(); setEditing(null);
            }}>
            {!editing ? <p className="t-bsm ink2">{terms.length ? "The account is created pending; send the invitation from People & access so they can sign in." : "No active term yet — create one under Academic setup first."}</p> : null}
          </RecordForm>
        </div>
        <div className="col-7 card">
          <div className="card-h">
            <b><Users size={18} />Student directory</b>
            <div className="btnrow">
              {pending ? <Pill kind="cau">{pending} awaiting invitation</Pill> : null}
              <label className="field inline" style={{ gap: 6 }}><Search size={16} color="var(--muted)" /><input className="input sm" type="search" placeholder="Name, admission or email" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(25); }} style={{ width: 220 }} aria-label="Find a student" /></label>
            </div>
          </div>
          {visible.length === 0 ? <Empty>{data.students.length ? "No students match." : "No students yet. Add the first one on the left."}</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Student</th><th>Admission</th><th>Enrolment</th><th>Account</th><th></th></tr></thead>
              <tbody>{visible.slice(0, limit).map((student) => (
                <tr key={student.id}>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Initials name={fullName(student)} /><div className="rowtxt"><b>{fullName(student)}</b><span>{student.email}</span></div></div></td>
                  <td className="mono">{student.admission_number}</td>
                  <td className="ink2">{enrolledIn(student.id) ?? <span className="faint">Not enrolled</span>}</td>
                  <td>{student.onboarding_pending ? <Status tone="cau">Invitation needed</Status> : <Status tone="pos">Ready</Status>}</td>
                  <td className="num"><button className="btn sm" onClick={() => setEditing(student)}>Edit</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {visible.length > limit ? <div className="btnrow" style={{ padding: "12px 20px", borderTop: "1px solid var(--line-3)" }}><button className="btn sm" onClick={() => setLimit((n) => n + 50)}>Show more</button><span className="t-bsm faint">{Math.min(limit, visible.length)} of {visible.length}</span></div> : null}
        </div>
      </div>

      <div className="grid12">
        <div className="col-5">
          <RecordForm icon={Link2} title="Link a guardian" fields={[
            ...personFields, { name: "phone", label: "Phone", type: "tel" },
            { name: "student_id", label: "Student", options: studentOptions },
            { name: "relationship", label: "Relationship", options: ["mother", "father", "guardian"].map((item) => ({ value: item, label: item[0]!.toUpperCase() + item.slice(1) })) },
          ]} onSave={async (values) => { await save(school, "guardians", { ...values, is_primary: values.is_primary === "on", can_authorize_leave: values.can_authorize_leave === "on" }); await refresh(); }}>
            <div className="col xs">
              <label className="check"><input name="is_primary" type="checkbox" /><span><b>Primary guardian</b> — replaces the current primary for this student.</span></label>
              <label className="check"><input name="can_authorize_leave" type="checkbox" defaultChecked /><span><b>Can authorise leave</b> — their sign-off sends a request to the principal.</span></label>
            </div>
            <p className="t-bsm ink2">If this email already has an account, invite it as a guardian under People & access first; it must accept before it can be linked.</p>
          </RecordForm>
        </div>
        <div className="col-7 card">
          <div className="card-h"><b><Link2 size={18} />Guardian links</b><span className="aside">{data.guardians.length}</span></div>
          {data.guardians.length === 0 ? <Empty>No guardians linked yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Guardian</th><th>Student</th><th>Relationship</th><th>Phone</th></tr></thead>
              <tbody>{data.guardians.map((item) => { const s = data.students.find((x) => x.id === item.student_id); return (
                <tr key={item.id}>
                  <td><div className="rowtxt"><b>{fullName(item)}</b><span>{item.email}</span></div></td>
                  <td>{s ? <div className="rowtxt"><b>{fullName(s)}</b><span className="mono">{s.admission_number}</span></div> : <span className="faint">—</span>}</td>
                  <td><Pill kind="soft">{item.relationship}</Pill></td>
                  <td className="ink2">{item.phone || "—"}</td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
        </div>
      </div>

      <div className="grid12">
        <div className="col-5">
          <RecordForm icon={GraduationCap} title="Enrol an existing student in a term" fields={[{ name: "student_id", label: "Student", options: studentOptions }, ...enrollmentFields]}
            onSave={async (values) => { await save(school, "enrollments", { ...values, roll_number: Number(values.roll_number) }); await refresh(); }}>
            <p className="t-bsm ink2">Use this for a student who already exists but has no enrolment in the current term. For a whole class, use Import & promotion.</p>
          </RecordForm>
        </div>
      </div>
    </div>
  );
}
