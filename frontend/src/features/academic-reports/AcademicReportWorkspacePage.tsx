import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, FileCheck2, Plus, Printer, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import {
  activateGradingScheme,
  createGradingScheme,
  generateReportBatch,
  getGradingScheme,
  getReportBatch,
  reportBatchAction,
  saveGradingSubject,
  updateReportComments,
  type AcademicReportWorkspace,
  type FamilyReportCards,
  type GradingSchemeDetail,
  type ReportBatchDetail,
} from "./api";
import "./academic-reports.css";

const nice = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Not published";

export function AcademicReportWorkspacePage({ portal, schoolId, schoolName, data, refresh }: { portal: "principal" | "teacher"; schoolId: string; schoolName?: string; data: AcademicReportWorkspace; refresh: () => Promise<void> }) {
  const startsWithReleases = Boolean(data.batches.length);
  const [activeList, setActiveList] = useState<"schemes" | "releases">(startsWithReleases ? "releases" : "schemes");
  const [selectedScheme, setSelectedScheme] = useState<string | null>(startsWithReleases ? null : data.schemes[0]?.id ?? null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(data.batches[0]?.id ?? null);
  const [dialog, setDialog] = useState<"scheme" | "subject" | null>(null);
  const scheme = useQuery({ queryKey: ["grading-scheme", schoolId, selectedScheme], queryFn: () => getGradingScheme(schoolId, selectedScheme!), enabled: data.mode === "admin" && Boolean(selectedScheme) });
  const batch = useQuery({ queryKey: ["report-batch", schoolId, selectedBatch], queryFn: () => getReportBatch(schoolId, selectedBatch!), enabled: Boolean(selectedBatch) });
  const counts = useMemo(() => ({ schemes: data.schemes.filter((item) => item.status === "active").length, review: data.batches.filter((item) => item.status === "draft").length, published: data.batches.filter((item) => item.status === "published").length }), [data]);

  async function refreshAll() {
    await Promise.all([refresh(), scheme.refetch(), batch.refetch()]);
  }

  function showSchemes() {
    setActiveList("schemes");
    setSelectedBatch(null);
    setSelectedScheme((current) => current ?? data.schemes[0]?.id ?? null);
  }

  function showReleases() {
    setActiveList("releases");
    setSelectedScheme(null);
    setSelectedBatch((current) => current ?? data.batches[0]?.id ?? null);
  }

  return <OperationsShell portal={portal} active="more" title="Report cards" schoolName={schoolName} backTo={`/${portal}/more`}>
    <div className="report-page">
      <section className="report-summary" aria-label="Report card status"><span><b>{counts.schemes}</b> active schemes</span><span><b>{counts.review}</b> to review</span><span><b>{counts.published}</b> published</span></section>
      <section className="report-workspace">
        <article className="report-panel report-library">
          <header>
            <div className="report-library-tabs" role="tablist" aria-label="Report card workspace">
              <button role="tab" aria-selected={activeList === "schemes"} className={activeList === "schemes" ? "is-active" : ""} onClick={showSchemes}><Settings2 size={16} /><span>Schemes</span><b>{data.schemes.length}</b></button>
              <button role="tab" aria-selected={activeList === "releases"} className={activeList === "releases" ? "is-active" : ""} onClick={showReleases}><FileCheck2 size={16} /><span>Releases</span><b>{data.batches.length}</b></button>
            </div>
            {data.mode === "admin" ? <button className="report-new-scheme" onClick={() => setDialog("scheme")}><Plus size={17} /><span>New scheme</span></button> : null}
          </header>
          <div className="report-list" role="tabpanel">
            {activeList === "schemes" ? data.schemes.length ? data.schemes.map((item) => <button key={item.id} className={selectedScheme === item.id ? "is-selected" : ""} onClick={() => { setSelectedScheme(item.id); setSelectedBatch(null); }}><span><strong>{item.name}</strong><small>{item.class_name} · {item.term_name}</small></span><i className={`report-status report-status--${item.status}`}>{nice(item.status)}</i><ChevronRight size={17} /></button>) : <p className="report-empty">No grading schemes</p>
              : data.batches.length ? data.batches.map((item) => <button key={item.id} className={selectedBatch === item.id ? "is-selected" : ""} onClick={() => { setSelectedBatch(item.id); setSelectedScheme(null); }}><span><strong>{item.scheme_name}</strong><small>{item.class_name} · Release {item.sequence}</small></span><i className={`report-status report-status--${item.status}`}>{nice(item.status)}</i><ChevronRight size={17} /></button>) : <p className="report-empty">No report releases</p>}
          </div>
        </article>
        <article className="report-panel report-detail">
          {selectedBatch ? batch.isPending ? <p className="report-empty">Opening reports…</p> : batch.error ? <p className="report-error">{batch.error.message}</p> : batch.data ? <BatchPanel portal={portal} schoolId={schoolId} detail={batch.data} refresh={refreshAll} /> : null
            : selectedScheme && data.mode === "admin" ? scheme.isPending ? <p className="report-empty">Opening scheme…</p> : scheme.error ? <p className="report-error">{scheme.error.message}</p> : scheme.data ? <SchemePanel schoolId={schoolId} detail={scheme.data} reportCount={data.schemes.find((item) => item.id === selectedScheme)?.report_count ?? 0} onAddSubject={() => setDialog("subject")} refresh={refreshAll} /> : null
              : <p className="report-empty">Choose a grading scheme or report release.</p>}
        </article>
      </section>
      {dialog === "scheme" && data.mode === "admin" ? <SchemeDialog schoolId={schoolId} data={data} close={() => setDialog(null)} saved={async (id) => { setDialog(null); setActiveList("schemes"); setSelectedScheme(id); setSelectedBatch(null); await refresh(); }} /> : null}
      {dialog === "subject" && data.mode === "admin" && scheme.data ? <SubjectDialog schoolId={schoolId} data={data} scheme={scheme.data} close={() => setDialog(null)} saved={async () => { setDialog(null); await refreshAll(); }} /> : null}
    </div>
  </OperationsShell>;
}

function SchemePanel({ schoolId, detail, reportCount, onAddSubject, refresh }: { schoolId: string; detail: GradingSchemeDetail; reportCount: number; onAddSubject: () => void; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [correction, setCorrection] = useState("");
  async function activate() {
    setBusy("activate"); setError("");
    try { await activateGradingScheme(schoolId, detail.scheme.id, detail.scheme.revision, "Grading structure checked and activated."); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); }
  }
  async function generate() {
    setBusy("generate"); setError("");
    try { await generateReportBatch(schoolId, detail.scheme.id, detail.scheme.revision, correction); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); }
  }
  return <div className="report-scheme"><header><div><small>{detail.scheme.class_name} · {detail.scheme.term_name}</small><h2>{detail.scheme.name}</h2><p>{detail.scheme.code} · {nice(detail.scheme.review_mode)}</p></div><i className={`report-status report-status--${detail.scheme.status}`}>{nice(detail.scheme.status)}</i></header>
    <div className="report-policy-facts"><span><small>ABSENCE</small><strong>{nice(detail.scheme.absence_treatment)}</strong></span><span><small>SUBJECTS</small><strong>{detail.subjects.length}</strong></span><span><small>GRADE BANDS</small><strong>{detail.bands.length}</strong></span></div>
    {error ? <p className="report-error" role="alert">{error}</p> : null}
    <section className="report-band-strip" aria-label="Grade bands">{detail.bands.slice().reverse().map((band) => <span key={band.id}><b>{band.code}</b><small>{band.minimum_percentage}–{band.maximum_percentage}</small></span>)}</section>
    <section className="report-subject-plans"><header><h3>Subject plans</h3>{detail.scheme.status === "draft" ? <button onClick={onAddSubject}><Plus size={16} />Add subject</button> : null}</header>{detail.subjects.length ? detail.subjects.map((subject) => <article key={subject.id}><span className="report-subject-dot" style={{ background: subject.color }} /><div><strong>{subject.subject_name}</strong><small>{subject.pass_percentage ? `Pass ${subject.pass_percentage}%` : "No pass threshold"}</small></div><div>{detail.components.filter((item) => item.scheme_subject_id === subject.id).map((component) => <span key={component.id}>{component.name} {component.weight_percentage}% · {component.assessment_titles.length} assessment{component.assessment_titles.length === 1 ? "" : "s"}</span>)}</div></article>) : <p className="report-empty">Add a subject and map its published assessments.</p>}</section>
    <div className="report-primary-actions">{detail.scheme.status === "draft" ? <button disabled={Boolean(busy) || !detail.subjects.length} onClick={() => void activate()}>{busy === "activate" ? "Activating…" : "Activate scheme"}</button> : <><label>{reportCount ? "Correction reason" : "First release"}<input value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder={reportCount ? "Why is a new report needed?" : "No reason required"} /></label><button disabled={Boolean(busy) || (reportCount > 0 && correction.trim().length < 3)} onClick={() => void generate()}>{busy === "generate" ? "Generating…" : reportCount ? "Generate correction" : "Generate reports"}</button></>}</div>
  </div>;
}

function BatchPanel({ portal, schoolId, detail, refresh }: { portal: "principal" | "teacher"; schoolId: string; detail: ReportBatchDetail; refresh: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const learners = detail.students.filter((student) => `${student.first_name} ${student.last_name} ${student.admission_number} ${student.roll_number ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function act(action: "review" | "publish" | "cancel") {
    setBusy(action); setError("");
    try { await reportBatchAction(schoolId, detail.batch.id, action, detail.batch.revision, note); setNote(""); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); }
  }
  return <div className="report-batch"><header><div><small>{detail.batch.class_name} · {detail.batch.term_name}</small><h2>{detail.batch.scheme_name}</h2><p>Release {detail.batch.sequence} · Generated {date(detail.batch.generated_at)}</p></div><i className={`report-status report-status--${detail.batch.status}`}>{nice(detail.batch.status)}</i></header>
    <div className="report-policy-facts"><span><small>LEARNERS</small><strong>{detail.students.length}</strong></span><span><small>COMPLETE</small><strong>{detail.students.filter((item) => item.outcome === "complete").length}</strong></span><span><small>INCOMPLETE</small><strong>{detail.students.filter((item) => item.outcome === "incomplete").length}</strong></span></div>
    {detail.batch.correction_reason ? <p className="report-correction">Correction: {detail.batch.correction_reason}</p> : null}{error ? <p className="report-error">{error}</p> : null}
    {portal === "principal" && ["draft", "reviewed"].includes(detail.batch.status) ? <div className="report-review-bar"><input aria-label="Review or publication note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required note" />{detail.batch.status === "draft" ? <button disabled={Boolean(busy) || note.trim().length < 3} onClick={() => void act("review")}>{busy === "review" ? "Reviewing…" : "Review batch"}</button> : <button disabled={Boolean(busy) || note.trim().length < 3} onClick={() => void act("publish")}>{busy === "publish" ? "Publishing…" : "Publish reports"}</button>}</div> : null}
    <div className="report-learner-tools"><label htmlFor="report-learner-search">Learners</label><input id="report-learner-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, roll or admission number" /><span>{learners.length} of {detail.students.length}</span></div>
    <div className="report-learners">{learners.length ? learners.map((student) => <LearnerReport key={`${student.id}-${student.comment_revision}`} portal={portal} schoolId={schoolId} batch={detail} student={student} refresh={refresh} />) : <p className="report-empty">No learners match this search.</p>}</div>
  </div>;
}

function LearnerReport({ portal, schoolId, batch, student, refresh }: { portal: "principal" | "teacher"; schoolId: string; batch: ReportBatchDetail; student: ReportBatchDetail["students"][number]; refresh: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [teacherComment, setTeacherComment] = useState(student.class_teacher_comment);
  const [principalComment, setPrincipalComment] = useState(student.principal_comment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subjects = batch.subjects.filter((item) => item.report_student_id === student.id);
  async function save() {
    setBusy(true); setError("");
    try { await updateReportComments(schoolId, batch.batch.id, student.student_id, { expected_revision: student.comment_revision, class_teacher_comment: teacherComment, principal_comment: principalComment }); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <article className={expanded ? "is-expanded" : ""}><button className="report-learner-summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span className="report-roll">{student.roll_number ?? "–"}</span><span className="report-learner-identity"><strong>{student.first_name} {student.last_name}</strong><small>{student.admission_number}</small></span><span className={`report-outcome report-outcome--${student.outcome}`}>{nice(student.outcome)}</span><span className="report-score"><b>{student.overall_percentage ?? "—"}{student.overall_percentage ? "%" : ""}</b><small>{student.overall_grade}</small></span>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
    {expanded ? <div className="report-learner-detail"><div className="report-subject-grid">{subjects.map((subject) => <span key={subject.id}><i style={{ background: subject.color }} /><strong>{subject.subject_name}</strong><b>{subject.percentage ? `${subject.percentage}%` : nice(subject.outcome)}</b><small>{subject.grade}{subject.passed === false ? " · Below pass" : ""}</small></span>)}</div>
      {batch.batch.status === "draft" ? <div className="report-comments"><label>Class teacher remark<textarea rows={2} value={teacherComment} onChange={(event) => setTeacherComment(event.target.value)} /></label>{portal === "principal" ? <label>Principal remark<textarea rows={2} value={principalComment} onChange={(event) => setPrincipalComment(event.target.value)} /></label> : null}<button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save remarks"}</button>{error ? <p>{error}</p> : null}</div> : student.class_teacher_comment || student.principal_comment ? <div className="report-read-comments">{student.class_teacher_comment ? <p><b>Class teacher</b>{student.class_teacher_comment}</p> : null}{student.principal_comment ? <p><b>Principal</b>{student.principal_comment}</p> : null}</div> : null}</div> : null}
  </article>;
}

function SchemeDialog({ schoolId, data, close, saved }: { schoolId: string; data: Extract<AcademicReportWorkspace, { mode: "admin" }>; close: () => void; saved: (id: string) => Promise<void> }) {
  const [bands, setBands] = useState([{ code: "F", label: "Needs support", min: "0", max: "39.99" }, { code: "E", label: "Emerging", min: "40", max: "49.99" }, { code: "D", label: "Developing", min: "50", max: "59.99" }, { code: "C", label: "Satisfactory", min: "60", max: "69.99" }, { code: "B", label: "Good", min: "70", max: "79.99" }, { code: "A", label: "Excellent", min: "80", max: "89.99" }, { code: "A+", label: "Outstanding", min: "90", max: "100" }]);
  const [step, setStep] = useState<"details" | "bands">("details");
  const [schemeName, setSchemeName] = useState("");
  const [schemeCode, setSchemeCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? []).filter((element) => !element.closest("[hidden]"));
      if (!focusable.length) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [close]);
  function updateName(value: string) {
    setSchemeName(value);
    if (!codeEdited) setSchemeCode(value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, ""));
  }
  function continueToBands() {
    if (formRef.current?.reportValidity()) setStep("bands");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { const result = await createGradingScheme(schoolId, { term_id: form.get("term_id"), class_section_id: form.get("class_section_id"), name: form.get("name"), code: form.get("code"), absence_treatment: form.get("absence_treatment"), review_mode: form.get("review_mode"), bands: bands.map((band) => ({ code: band.code, label: band.label, minimum_percentage: Number(band.min), maximum_percentage: Number(band.max) })) }); await saved(result.id); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <div className="report-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={dialogRef} className="report-dialog report-scheme-dialog" role="dialog" aria-modal="true" aria-labelledby="scheme-title"><header><div><small>GRADING POLICY</small><h2 id="scheme-title">New grading scheme</h2></div><button ref={closeRef} type="button" onClick={close} aria-label="Close"><X /></button></header>
    <nav className="report-dialog-steps" aria-label="Scheme setup progress"><button type="button" className={step === "details" ? "is-active" : "is-complete"} onClick={() => setStep("details")}><b>1</b><span>Details</span></button><i /><button type="button" className={step === "bands" ? "is-active" : ""} onClick={continueToBands}><b>2</b><span>Grade bands</span></button></nav>
    <form ref={formRef} onSubmit={(event) => void submit(event)}>
      <section className="report-dialog-stage" hidden={step !== "details"} aria-labelledby="scheme-details-heading"><div className="report-stage-heading"><h3 id="scheme-details-heading">Report setup</h3><p>Choose where this grading policy applies.</p></div><div className="report-form-grid"><label>Term<select name="term_id" required>{data.references.terms.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.academic_year}</option>)}</select></label><label>Class<select name="class_section_id" required>{data.references.classes.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.academic_year}</option>)}</select></label><label>Scheme name<input name="name" required placeholder="Term 1 report" value={schemeName} onChange={(event) => updateName(event.target.value)} /></label><label>Code<input name="code" required placeholder="TERM-1-REPORT" value={schemeCode} onChange={(event) => { setCodeEdited(true); setSchemeCode(event.target.value.toUpperCase()); }} /></label><label>Absent result<select name="absence_treatment"><option value="incomplete">Keep report incomplete</option><option value="zero">Count as zero</option></select></label><label>Approval<select name="review_mode"><option value="independent">Independent reviewer</option><option value="owner_review">Owner review</option></select></label></div></section>
      <section className="report-dialog-stage" hidden={step !== "bands"} aria-labelledby="grade-bands-heading"><div className="report-stage-heading"><h3 id="grade-bands-heading">Grade bands</h3><p>Confirm the labels and percentage ranges.</p></div><div className="report-band-editor">{bands.map((band, index) => <div className="report-band-row" key={`${band.code}-${index}`}><label><span>Grade</span><input aria-label={`Grade code ${index + 1}`} required value={band.code} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /></label><label><span>Meaning</span><input aria-label={`Grade label ${index + 1}`} required value={band.label} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /></label><div className="report-band-range"><label><span>From</span><input aria-label={`Minimum ${index + 1}`} required type="number" min="0" max="100" step="0.01" value={band.min} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, min: event.target.value } : item))} /></label><label><span>To</span><input aria-label={`Maximum ${index + 1}`} required type="number" min="0" max="100" step="0.01" value={band.max} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, max: event.target.value } : item))} /></label></div></div>)}</div></section>
      {error ? <p className="report-error" role="alert">{error}</p> : null}<footer><button type="button" className="is-secondary" onClick={step === "details" ? close : () => setStep("details")}>{step === "details" ? "Cancel" : "Back"}</button>{step === "details" ? <button type="button" onClick={continueToBands}>Continue</button> : <button disabled={busy}>{busy ? "Creating…" : "Create scheme"}</button>}</footer>
    </form></section></div>;
}

function SubjectDialog({ schoolId, data, scheme, close, saved }: { schoolId: string; data: Extract<AcademicReportWorkspace, { mode: "admin" }>; scheme: GradingSchemeDetail; close: () => void; saved: () => Promise<void> }) {
  const [subjectId, setSubjectId] = useState(data.references.subjects[0]?.id ?? "");
  const [components, setComponents] = useState([{ name: "Term assessment", code: "TERM", weight: "100", assessmentIds: [] as string[] }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const eligible = data.references.assessments.filter((item) => item.subject_id === subjectId && item.class_section_id === scheme.scheme.class_section_id && item.term_id === scheme.scheme.term_id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await saveGradingSubject(schoolId, scheme.scheme.id, { subject_id: subjectId, pass_percentage: form.get("pass_percentage") ? Number(form.get("pass_percentage")) : null, expected_revision: scheme.scheme.revision, components: components.map((item) => ({ code: item.code, name: item.name, weight_percentage: Number(item.weight), assessment_ids: item.assessmentIds })) }); await saved(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <div className="report-dialog-backdrop"><section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="subject-plan-title"><header><h2 id="subject-plan-title">Subject grading plan</h2><button onClick={close} aria-label="Close"><X /></button></header><form onSubmit={(event) => void submit(event)}><div className="report-form-grid"><label>Subject<select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setComponents((current) => current.map((item) => ({ ...item, assessmentIds: [] }))); }}>{data.references.subjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Pass percentage<input name="pass_percentage" type="number" min="0" max="100" step="0.01" defaultValue="40" /></label></div><fieldset><legend>Components</legend>{components.map((component, index) => <article className="report-component-form" key={index}><div><input aria-label={`Component name ${index + 1}`} value={component.name} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input aria-label={`Component code ${index + 1}`} value={component.code} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /><input aria-label={`Component weight ${index + 1}`} type="number" min="0.01" max="100" step="0.01" value={component.weight} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, weight: event.target.value } : item))} /></div><strong>Published assessments</strong>{eligible.length ? eligible.map((assessment) => <label className="report-check" key={assessment.id}><input type="checkbox" checked={component.assessmentIds.includes(assessment.id)} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, assessmentIds: event.target.checked ? [...item.assessmentIds, assessment.id] : item.assessmentIds.filter((id) => id !== assessment.id) } : item))} /><span>{assessment.title} · {assessment.maximum_marks} marks</span></label>) : <p>No published assessments for this class, term and subject.</p>}</article>)}<button type="button" className="report-add-component" onClick={() => setComponents((current) => [...current, { name: "", code: "", weight: "", assessmentIds: [] }])}><Plus size={16} />Add component</button></fieldset>{error ? <p className="report-error">{error}</p> : null}<footer><button type="button" className="is-secondary" onClick={close}>Cancel</button><button disabled={busy || !eligible.length}>{busy ? "Saving…" : "Save subject plan"}</button></footer></form></section></div>;
}

export function FamilyReportCardList({ data }: { data: FamilyReportCards }) {
  if (!data.reports.length) return null;
  return <section className="family-report-cards"><header><div><span>REPORT CARDS</span><h2>Term reports</h2></div><button onClick={() => window.print()}><Printer size={17} />Print</button></header>{data.reports.map((report) => <article key={report.batch_id}><header><div><small>{report.term_name} · {report.academic_year}</small><h3>{report.scheme_name}</h3></div><div className="family-report-total"><strong>{report.overall_percentage ?? "—"}{report.overall_percentage ? "%" : ""}</strong><span>{report.overall_grade || nice(report.outcome)}</span></div></header><div className="family-report-subjects">{report.subjects.map((subject) => <span key={subject.id}><i style={{ background: subject.color }} /><strong>{subject.subject_name}</strong><b>{subject.percentage ? `${subject.percentage}%` : nice(subject.outcome)}</b><small>{subject.grade}{subject.passed === false ? " · Below pass" : ""}</small></span>)}</div>{report.class_teacher_comment || report.principal_comment ? <div className="family-report-comments">{report.class_teacher_comment ? <p><b>Class teacher</b>{report.class_teacher_comment}</p> : null}{report.principal_comment ? <p><b>Principal</b>{report.principal_comment}</p> : null}</div> : null}<footer><span><CheckCircle2 size={15} />Published {date(report.published_at)}</span>{report.sequence > 1 ? <em>Correction {report.sequence}</em> : null}</footer></article>)}</section>;
}
