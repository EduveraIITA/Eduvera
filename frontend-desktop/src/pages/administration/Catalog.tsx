import { useState } from "react";
import type { Administration } from "../../features/administration";
import { save } from "../../features/administration";
import { RecordForm, type Field } from "./RecordForm";

export function Catalog({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const [kind, setKind] = useState<"terms" | "classes" | "subjects">("terms");
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const fields: Field[] = kind === "terms" ? [
    { name: "name", label: "Term name" }, { name: "academic_year", label: "Academic year (2026-2027)" },
    { name: "starts_on", label: "Starts", type: "date" }, { name: "ends_on", label: "Ends", type: "date" },
    { name: "attendance_threshold", label: "Attendance threshold (%)", type: "number", min: 0, max: 100, step: ".01", value: "85" },
  ] : kind === "classes" ? [
    { name: "academic_year", label: "Academic year (match the term)" }, { name: "grade", label: "Grade" },
    { name: "section", label: "Section" }, { name: "board", label: "Board", optional: true }, { name: "room_number", label: "Room", optional: true },
  ] : [{ name: "code", label: "Subject code" }, { name: "name", label: "Name" }, { name: "short_name", label: "Short name" }];
  return <div className="ops-stack">
    <div className="ops-tabs">{(["terms", "classes", "subjects"] as const).map((item) => <button key={item} className="btn" aria-pressed={kind === item} onClick={() => { setKind(item); setEditing(null); }}>{item}</button>)}</div>
    <RecordForm key={`${kind}-${editing?.id ?? "new"}`} title={`${editing ? "Edit" : "Create"} ${kind.replace(/s$/, "")}`} fields={fields.map((field) => ({ ...field, value: editing?.[field.name] ?? field.value }))}
      onCancel={editing ? () => setEditing(null) : undefined} onSave={async (values) => {
        const body = kind === "terms" ? { ...values, attendance_threshold: Number(values.attendance_threshold) } : values;
        await save(school, `catalog/${kind}${editing ? `/${editing.id}` : ""}`, body, editing ? "PATCH" : "POST");
        await refresh(); setEditing(null);
      }} />
    <section className="card ops-panel"><h2>School {kind}</h2><div className="ops-table"><table><thead><tr><th>Name</th><th>Details</th><th>Action</th></tr></thead><tbody>
      {data[kind].map((item) => {
        const row = item as unknown as Record<string, string>;
        return <tr key={item.id}><td>{row.name ?? `${row.grade} ${row.section}`}</td><td>{row.academic_year ?? row.code}</td><td><button className="btn sm" onClick={() => setEditing(row)}>Edit</button></td></tr>;
      })}
    </tbody></table>{!data[kind].length ? <p>No {kind} yet. Create the first record above.</p> : null}</div></section>
  </div>;
}
