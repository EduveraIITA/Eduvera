import { BookOpen, CalendarRange, Layers, Pencil } from "lucide-react";
import { useState } from "react";
import { Empty, Pill, Status, Tabs, fmtDate } from "../../components/ui";
import type { Administration } from "../../features/administration";
import { save } from "../../features/administration";
import { RecordForm, type Field } from "./RecordForm";

type Kind = "terms" | "classes" | "subjects";
const LABEL: Record<Kind, string> = { terms: "Term", classes: "Class", subjects: "Subject" };
const ICON = { terms: CalendarRange, classes: Layers, subjects: BookOpen } as const;

/* Academic setup: the three catalogues a school needs before anyone can be enrolled. */
export function Catalog({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const [kind, setKind] = useState<Kind>("terms");
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const fields: Field[] = kind === "terms" ? [
    { name: "name", label: "Term name", placeholder: "Term 1" }, { name: "academic_year", label: "Academic year", placeholder: "2026-2027" },
    { name: "starts_on", label: "Starts", type: "date" }, { name: "ends_on", label: "Ends", type: "date" },
    { name: "attendance_threshold", label: "Attendance threshold (%)", type: "number", min: 0, max: 100, step: ".01", value: "85", hint: "Students below this are flagged on the principal's overview." },
  ] : kind === "classes" ? [
    { name: "academic_year", label: "Academic year", hint: "Must match the term's year." }, { name: "grade", label: "Grade", placeholder: "7" },
    { name: "section", label: "Section", placeholder: "A" }, { name: "board", label: "Board", optional: true, placeholder: "CBSE" }, { name: "room_number", label: "Room", optional: true },
  ] : [{ name: "code", label: "Subject code", placeholder: "MATH" }, { name: "name", label: "Name" }, { name: "short_name", label: "Short name" }];
  const rows = data[kind] as unknown as Array<Record<string, string | boolean>>;
  const Icon = ICON[kind];

  return (
    <div className="col">
      <Tabs value={kind} onChange={(k) => { setKind(k); setEditing(null); }} items={[
        { id: "terms", label: "Terms" }, { id: "classes", label: "Classes" }, { id: "subjects", label: "Subjects" },
      ]} />
      <div className="grid12">
        <div className="col-5">
          <RecordForm key={`${kind}-${editing?.id ?? "new"}`} icon={Icon} title={`${editing ? "Edit" : "Add"} ${LABEL[kind].toLowerCase()}`}
            fields={fields.map((field) => ({ ...field, value: editing?.[field.name] ?? field.value }))}
            onCancel={editing ? () => setEditing(null) : undefined}
            onSave={async (values) => {
              const body = kind === "terms" ? { ...values, attendance_threshold: Number(values.attendance_threshold) } : values;
              await save(school, `catalog/${kind}${editing ? `/${editing.id}` : ""}`, body, editing ? "PATCH" : "POST");
              await refresh(); setEditing(null);
            }}>
            {kind === "terms" ? <p className="t-bsm ink2">Registers, leave and thresholds all hang off the active term. Create it first, then classes, then students.</p> : null}
          </RecordForm>
        </div>
        <div className="col-7 card">
          <div className="card-h"><b><Icon size={18} />School {kind}</b><span className="aside">{rows.length} record{rows.length === 1 ? "" : "s"}</span></div>
          {rows.length === 0 ? <Empty>No {kind} yet. Add the first one on the left.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr>
                {kind === "terms" ? <><th>Term</th><th>Year</th><th>Dates</th><th className="num">Threshold</th><th>Status</th></>
                  : kind === "classes" ? <><th>Class</th><th>Year</th><th>Board</th><th>Room</th></>
                    : <><th>Code</th><th>Name</th><th>Short</th></>}
                <th></th>
              </tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={String(row.id)}>
                  {kind === "terms" ? <>
                    <td className="t-llg">{row.name}</td><td className="ink2">{row.academic_year}</td>
                    <td className="ink2">{fmtDate(String(row.starts_on), { day: "numeric", month: "short" })} – {fmtDate(String(row.ends_on), { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="num">{row.attendance_threshold}%</td>
                    <td>{row.is_active ? <Status tone="pos">Active</Status> : <Status tone="neu">Inactive</Status>}</td>
                  </> : kind === "classes" ? <>
                    <td className="t-llg">Class {row.grade}{row.section}</td><td className="ink2">{row.academic_year}</td>
                    <td>{row.board ? <Pill kind="soft">{row.board}</Pill> : <span className="faint">—</span>}</td><td className="ink2">{row.room_number || "—"}</td>
                  </> : <>
                    <td className="mono">{row.code}</td><td className="t-llg">{row.name}</td><td className="ink2">{row.short_name}</td>
                  </>}
                  <td className="num"><button className="btn sm" onClick={() => setEditing(row as Record<string, string>)}><Pencil size={14} />Edit</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </div>
  );
}
