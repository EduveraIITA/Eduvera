import { useState } from "react";
import { type Administration, type Student, fullName, save } from "../../features/administration";
import { RecordForm, type Field } from "./RecordForm";

const personFields: Field[] = [{ name: "first_name", label: "First name" }, { name: "last_name", label: "Last name" }, { name: "email", label: "Email", type: "email" }];
export function Students({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<Student | null>(null);
  const [search, setSearch] = useState("");
  const classes = data.classes.map((item) => ({ value: item.id, label: `${item.grade} ${item.section} · ${item.academic_year}` }));
  const terms = data.terms.filter((item) => item.is_active).map((item) => ({ value: item.id, label: `${item.name} · ${item.academic_year}` }));
  const enrollmentFields: Field[] = [{ name: "class_section_id", label: "Class", options: classes }, { name: "term_id", label: "Term", options: terms }, { name: "roll_number", label: "Roll number", type: "number", min: 1, max: 32767 }];
  const fields: Field[] = [
    ...personFields.filter((field) => !editing || field.name !== "email"),
    { name: "admission_number", label: "Admission number" }, { name: "date_of_birth", label: "Date of birth", type: "date", optional: true },
    ...(!editing ? enrollmentFields : []),
  ];
  const visible = data.students.filter((item) => `${fullName(item)} ${item.admission_number} ${item.email}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="ops-stack">
    <RecordForm key={editing?.id ?? "new"} title={editing ? "Edit student" : "Add student and enrollment"} fields={fields.map((field) => ({ ...field, value: editing ? String((editing as unknown as Record<string, unknown>)[field.name] ?? "") : undefined }))}
      onCancel={editing ? () => setEditing(null) : undefined} onSave={async (values) => {
        await save(school, `students${editing ? `/${editing.id}` : ""}`, { ...values, date_of_birth: values.date_of_birth || null, ...(!editing ? { roll_number: Number(values.roll_number) } : {}) }, editing ? "PATCH" : "POST");
        await refresh(); setEditing(null);
      }}><p className="muted">New accounts cannot sign in until they accept a private invitation. Create the term and class first.</p></RecordForm>
    <section className="card ops-panel"><h2>Student directory</h2><label>Find a student<input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="ops-table"><table><thead><tr><th>Student</th><th>Admission</th><th>Account</th><th>Action</th></tr></thead><tbody>{visible.map((student) => <tr key={student.id}><td>{fullName(student)}<br /><span className="muted">{student.email}</span></td><td>{student.admission_number}</td><td>{student.onboarding_pending ? "Invitation needed" : "Ready"}</td><td><button className="btn sm" onClick={() => setEditing(student)}>Edit</button></td></tr>)}</tbody></table>{!visible.length ? <p>No students match.</p> : null}</div>
    </section>
    <RecordForm title="Link or update guardian" fields={[...personFields, { name: "phone", label: "Phone", type: "tel" }, { name: "student_id", label: "Student", options: data.students.map((item) => ({ value: item.id, label: `${fullName(item)} · ${item.admission_number}` })) }, { name: "relationship", label: "Relationship", options: ["mother", "father", "guardian"].map((item) => ({ value: item, label: item })) }]}
      onSave={async (values) => { await save(school, "guardians", { ...values, is_primary: values.is_primary === "on", can_authorize_leave: values.can_authorize_leave === "on" }); await refresh(); }}>
      <label className="ops-check"><input name="is_primary" type="checkbox" />Primary guardian (replaces the current primary)</label>
      <label className="ops-check"><input name="can_authorize_leave" type="checkbox" defaultChecked />Can authorize leave</label>
    </RecordForm>
    <section className="card ops-panel"><h2>Guardian links</h2><div className="ops-table"><table><thead><tr><th>Guardian</th><th>Student</th><th>Relationship</th></tr></thead><tbody>{data.guardians.map((item) => <tr key={item.id}><td>{fullName(item)}<br />{item.email}</td><td>{data.students.find((s) => s.id === item.student_id)?.admission_number}</td><td>{item.relationship}</td></tr>)}</tbody></table>{!data.guardians.length ? <p>No guardians linked yet.</p> : null}</div></section>
    <RecordForm title="Enroll an existing student in a new term" fields={[{ name: "student_id", label: "Student", options: data.students.map((item) => ({ value: item.id, label: fullName(item) })) }, ...enrollmentFields]}
      onSave={async (values) => { await save(school, "enrollments", { ...values, roll_number: Number(values.roll_number) }); await refresh(); }} />
  </div>;
}
