import { AlertTriangle, CheckCircle2, ChevronRight, Palette, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { saveCatalog, type Administration, type CatalogKind, type ClassSection, type Subject, type Term } from "./api";

type CatalogRow = Term | ClassSection | Subject;
type EditorState = { kind: CatalogKind; row?: CatalogRow };

const catalogs: Array<{ id: CatalogKind; label: string; singular: string }> = [
  { id: "terms", label: "Terms", singular: "term" },
  { id: "classes", label: "Classes", singular: "class" },
  { id: "subjects", label: "Subjects", singular: "subject" },
];

const subjectIcons = [
  ["book-open", "General subject"],
  ["calculator", "Mathematics"],
  ["flask-conical", "Science"],
  ["languages", "Language"],
  ["palette", "Art and design"],
  ["dumbbell", "Physical education"],
  ["laptop", "Computing"],
  ["globe-2", "Social science"],
] as const;

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
const fieldValue = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

function usage(kind: CatalogKind, row?: CatalogRow) {
  if (!row) return { total: 0, details: [] as string[] };
  if (kind === "terms") {
    const term = row as Term;
    return { total: term.enrollment_count + term.timetable_count + term.register_count, details: [`${term.enrollment_count} enrolments`, `${term.timetable_count} periods`, `${term.register_count} registers`] };
  }
  if (kind === "classes") {
    const section = row as ClassSection;
    return { total: section.enrollment_count + section.timetable_count + section.assignment_count, details: [`${section.enrollment_count} enrolments`, `${section.timetable_count} periods`, `${section.assignment_count} staff assignments`] };
  }
  const subject = row as Subject;
  return { total: subject.timetable_count + subject.attendance_count + subject.diary_count + subject.day_plan_count, details: [`${subject.timetable_count} periods`, `${subject.attendance_count} attendance records`, `${subject.diary_count} diary items`, `${subject.day_plan_count} day plans`] };
}

function recordName(kind: CatalogKind, row: CatalogRow) {
  if (kind === "classes") return `Class ${(row as ClassSection).grade}${(row as ClassSection).section}`;
  return (row as Term | Subject).name;
}

function recordMeta(kind: CatalogKind, row: CatalogRow) {
  if (kind === "terms") {
    const term = row as Term;
    return `${term.academic_year}, ${formatDate(term.starts_on)} to ${formatDate(term.ends_on)}, ${Number(term.attendance_threshold).toFixed(0)}% attendance${term.is_active ? ", active" : ", inactive"}`;
  }
  if (kind === "classes") {
    const section = row as ClassSection;
    return `${section.academic_year}, ${section.board || "Board not set"}, ${section.room_number || "Room not set"}`;
  }
  const subject = row as Subject;
  return `${subject.code}, ${subject.short_name}`;
}

function CatalogEditor({ schoolId, state, onClose, onSaved }: { schoolId: string; state: EditorState; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linked = usage(state.kind, state.row);
  const descriptor = catalogs.find((item) => item.id === state.kind)!;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    heading.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !sheet.current) return;
      const controls = [...sheet.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", handleKey); };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const common = state.row ? {
      expected_revision: state.row.revision,
      confirmed: linked.total ? form.has("confirmed") : true,
      change_reason: fieldValue(form, "change_reason"),
    } : {};
    const values = state.kind === "terms" ? {
      name: fieldValue(form, "name"),
      academic_year: fieldValue(form, "academic_year"),
      starts_on: fieldValue(form, "starts_on"),
      ends_on: fieldValue(form, "ends_on"),
      attendance_threshold: Number(fieldValue(form, "attendance_threshold")),
      is_active: form.has("is_active"),
      ...common,
    } : state.kind === "classes" ? {
      academic_year: fieldValue(form, "academic_year"),
      grade: fieldValue(form, "grade"),
      section: fieldValue(form, "section"),
      board: fieldValue(form, "board"),
      room_number: fieldValue(form, "room_number"),
      ...common,
    } : {
      code: fieldValue(form, "code"),
      name: fieldValue(form, "name"),
      short_name: fieldValue(form, "short_name"),
      color: fieldValue(form, "color"),
      icon: fieldValue(form, "icon"),
      ...common,
    };
    try {
      await saveCatalog(schoolId, state.kind, values, state.row?.id);
      await onSaved(`${recordName(state.kind, (state.row ?? values) as CatalogRow)} ${state.row ? "updated" : "created"}.`);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const term = state.kind === "terms" ? state.row as Term | undefined : undefined;
  const section = state.kind === "classes" ? state.row as ClassSection | undefined : undefined;
  const subject = state.kind === "subjects" ? state.row as Subject | undefined : undefined;
  return <div className="office-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section ref={sheet} className="office-sheet" role="dialog" aria-modal="true" aria-labelledby="catalog-editor-title">
      <div className="office-sheet__handle" aria-hidden="true" />
      <header className="office-sheet__header"><div><span>{state.row ? "EDIT RECORD" : "NEW RECORD"}</span><h2 id="catalog-editor-title" ref={heading} tabIndex={-1}>{state.row ? `Edit ${recordName(state.kind, state.row)}` : `Add ${descriptor.singular}`}</h2><p>Changes are saved to the school catalogue and used by connected modules.</p></div><button type="button" aria-label="Close editor" onClick={onClose} disabled={busy}><X size={21} /></button></header>
      <form className="office-form office-catalog-form" onSubmit={(event) => void submit(event)}>
        {state.kind === "terms" ? <div className="office-form-grid">
          <label className="office-field">Term name<input name="name" required maxLength={100} defaultValue={term?.name ?? ""} /></label>
          <label className="office-field">Academic year<input name="academic_year" required pattern="\d{4}-\d{2}(\d{2})?" placeholder="2026-27" defaultValue={term?.academic_year ?? ""} readOnly={Boolean(term)} /><small>{term ? "Create a new term to change the academic year." : "Use YYYY-YY, for example 2026-27."}</small></label>
          <label className="office-field">Starts on<input name="starts_on" type="date" required defaultValue={term?.starts_on ?? ""} /></label>
          <label className="office-field">Ends on<input name="ends_on" type="date" required defaultValue={term?.ends_on ?? ""} /></label>
          <label className="office-field">Attendance minimum (%)<input name="attendance_threshold" type="number" min="0" max="100" step="0.01" required defaultValue={term?.attendance_threshold ?? "85"} /></label>
          <label className="office-check office-check--field"><input type="checkbox" name="is_active" defaultChecked={term?.is_active ?? true} /> Available for current school operations</label>
        </div> : null}
        {state.kind === "classes" ? <div className="office-form-grid">
          <label className="office-field">Academic year<input name="academic_year" required pattern="\d{4}-\d{2}(\d{2})?" placeholder="2026-27" defaultValue={section?.academic_year ?? ""} readOnly={Boolean(section)} /><small>{section ? "Create a new class to change the academic year." : "Use YYYY-YY, for example 2026-27."}</small></label>
          <label className="office-field">Grade<input name="grade" required maxLength={16} defaultValue={section?.grade ?? ""} placeholder="7" /></label>
          <label className="office-field">Section<input name="section" required maxLength={16} defaultValue={section?.section ?? ""} placeholder="A" /></label>
          <label className="office-field">Board<input name="board" maxLength={100} defaultValue={section?.board ?? ""} placeholder="CBSE" /></label>
          <label className="office-field">Home room<input name="room_number" maxLength={32} defaultValue={section?.room_number ?? ""} placeholder="204" /></label>
        </div> : null}
        {state.kind === "subjects" ? <div className="office-form-grid">
          <label className="office-field">Subject code<input name="code" required maxLength={16} defaultValue={subject?.code ?? ""} placeholder="MATH" autoCapitalize="characters" /></label>
          <label className="office-field">Subject name<input name="name" required maxLength={100} defaultValue={subject?.name ?? ""} placeholder="Mathematics" /></label>
          <label className="office-field">Short name<input name="short_name" required maxLength={40} defaultValue={subject?.short_name ?? ""} placeholder="Maths" /></label>
          <label className="office-field">Timetable icon<select name="icon" defaultValue={subject?.icon ?? "book-open"}>{subjectIcons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="office-field office-color-field">Subject color<span><input name="color" type="color" defaultValue={subject?.color ?? "#1D4ED8"} aria-label="Subject color" /><b><Palette size={17} /> Used in timetable and day plans</b></span></label>
        </div> : null}
        {state.row ? <section className={`office-impact ${linked.total ? "office-impact--linked" : ""}`} aria-label="Change impact"><span><AlertTriangle size={19} /></span><div><strong>{linked.total ? `${linked.total} linked records` : "No linked records yet"}</strong><p>{linked.total ? "This record keeps its identity. Connected schedules and histories will show the new details immediately." : "This record can be updated without changing an existing schedule or history."}</p>{linked.total ? <ul>{linked.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}</div></section> : null}
        {state.row && linked.total ? <><label className="office-field">Reason for change<textarea name="change_reason" required minLength={8} maxLength={240} placeholder="Explain the reviewed school change" /></label><label className="office-check"><input type="checkbox" name="confirmed" required /> I reviewed the linked records and confirm this change takes effect immediately.</label></> : null}
        {error ? <p role="alert" className="office-alert">{error}</p> : null}
        <div className="office-actions office-sheet__actions"><button type="button" className="office-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="office-primary" disabled={busy}>{busy ? "Saving..." : state.row ? "Save changes" : `Add ${descriptor.singular}`}</button></div>
      </form>
    </section>
  </div>;
}

export function CatalogManager({ schoolId, data, refresh }: { schoolId: string; data: Administration; refresh: () => Promise<void> }) {
  const [kind, setKind] = useState<CatalogKind>("terms");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saved, setSaved] = useState("");
  const rows = data[kind] as CatalogRow[];
  const visibleRows = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return rows;
    return rows.filter((row) => `${recordName(kind, row)} ${recordMeta(kind, row)}`.toLowerCase().includes(value));
  }, [kind, rows, search]);
  const descriptor = catalogs.find((item) => item.id === kind)!;

  return <section className="office-panel office-catalog" aria-label="Academic setup">
    <div className="office-tabs office-tabs--compact" role="tablist" aria-label="Academic catalogue">{catalogs.map((item) => <button type="button" role="tab" aria-selected={kind === item.id} key={item.id} className={kind === item.id ? "is-active" : ""} onClick={() => { setKind(item.id); setSearch(""); setSaved(""); }}>{item.label}<span>{data[item.id].length}</span></button>)}</div>
    {rows.length > 5 ? <label className="office-field office-catalog-search"><span><Search size={16} /> Find {descriptor.label.toLowerCase()}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${descriptor.label.toLowerCase()}`} /></label> : null}
    {saved ? <p className="office-success" role="status"><CheckCircle2 size={17} />{saved}</p> : null}
    <div className="office-list office-record-list">{visibleRows.length ? visibleRows.map((row) => { const linked = usage(kind, row); return <div className="office-record office-catalog-record" key={row.id}><span className="office-catalog-record__swatch" style={kind === "subjects" ? { backgroundColor: (row as Subject).color } : undefined} aria-hidden="true" /><div><strong>{recordName(kind, row)}</strong><span>{recordMeta(kind, row)}</span><small>{linked.total ? `${linked.total} linked records` : "Not used yet"}, revision {row.revision}</small></div><button type="button" aria-label={`Edit ${recordName(kind, row)}`} onClick={() => { setSaved(""); setEditor({ kind, row }); }}>Edit <ChevronRight size={15} /></button></div>; }) : <p className="office-empty">{search ? `No ${descriptor.label.toLowerCase()} match this search.` : `No ${descriptor.label.toLowerCase()} yet. Add the first record.`}</p>}</div>
    <button type="button" className="office-secondary office-add" onClick={() => { setSaved(""); setEditor({ kind }); }}><Plus size={17} /> Add {descriptor.singular}</button>
    {editor ? <CatalogEditor schoolId={schoolId} state={editor} onClose={() => setEditor(null)} onSaved={async (message) => { setSaved(message); await refresh().catch(() => undefined); }} /> : null}
  </section>;
}
