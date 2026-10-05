import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Plus, Printer, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
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
  const [selectedScheme, setSelectedScheme] = useState<string | null>(data.schemes[0]?.id ?? null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(data.batches[0]?.id ?? null);
  const [dialog, setDialog] = useState<"scheme" | "subject" | null>(null);
  const scheme = useQuery({ queryKey: ["grading-scheme", schoolId, selectedScheme], queryFn: () => getGradingScheme(schoolId, selectedScheme!), enabled: data.mode === "admin" && Boolean(selectedScheme) });
  const batch = useQuery({ queryKey: ["report-batch", schoolId, selectedBatch], queryFn: () => getReportBatch(schoolId, selectedBatch!), enabled: Boolean(selectedBatch) });
  const counts = useMemo(() => ({ schemes: data.schemes.filter((item) => item.status === "active").length, review: data.batches.filter((item) => item.status === "draft").length, published: data.batches.filter((item) => item.status === "published").length }), [data]);

  async function refreshAll() {
    await Promise.all([refresh(), scheme.refetch(), batch.refetch()]);
  }

  return <OperationsShell portal={portal} active="more" title="Report cards" schoolName={schoolName} backTo={`/${portal}/more`}>
    <div className="report-page">
      <section className="report-summary" aria-label="Report card status"><span><b>{counts.schemes}</b> active schemes</span><span><b>{counts.review}</b> to review</span><span><b>{counts.published}</b> published</span></section>
      {data.mode === "admin" ? <div className="report-actions"><button onClick={() => setDialog("scheme")}><Plus size={17} />New scheme</button></div> : null}
      <section className="report-workspace">
        <div className="report-stack">
          <article className="report-panel report-list"><header><h2>Grading schemes</h2><span>{data.schemes.length}</span></header>{data.schemes.length ? data.schemes.map((item) => <button key={item.id} className={selectedScheme === item.id ? "is-selected" : ""} onClick={() => { setSelectedScheme(item.id); setSelectedBatch(null); }}><span><strong>{item.name}</strong><small>{item.class_name} · {item.term_name}</small></span><i className={`report-status report-status--${item.status}`}>{nice(item.status)}</i><ChevronRight size={17} /></button>) : <p className="report-empty">No grading schemes</p>}</article>
          <article className="report-panel report-list"><header><h2>Report releases</h2><span>{data.batches.length}</span></header>{data.batches.length ? data.batches.map((item) => <button key={item.id} className={selectedBatch === item.id ? "is-selected" : ""} onClick={() => { setSelectedBatch(item.id); setSelectedScheme(null); }}><span><strong>{item.scheme_name}</strong><small>{item.class_name} · Release {item.sequence}</small></span><i className={`report-status report-status--${item.status}`}>{nice(item.status)}</i><ChevronRight size={17} /></button>) : <p className="report-empty">No report releases</p>}</article>
        </div>
        <article className="report-panel report-detail">
          {selectedBatch ? batch.isPending ? <p className="report-empty">Opening reports…</p> : batch.error ? <p className="report-error">{batch.error.message}</p> : batch.data ? <BatchPanel portal={portal} schoolId={schoolId} detail={batch.data} refresh={refreshAll} /> : null
            : selectedScheme && data.mode === "admin" ? scheme.isPending ? <p className="report-empty">Opening scheme…</p> : scheme.error ? <p className="report-error">{scheme.error.message}</p> : scheme.data ? <SchemePanel schoolId={schoolId} detail={scheme.data} reportCount={data.schemes.find((item) => item.id === selectedScheme)?.report_count ?? 0} onAddSubject={() => setDialog("subject")} refresh={refreshAll} /> : null
              : <p className="report-empty">Choose a grading scheme or report release.</p>}
        </article>
      </section>
      {dialog === "scheme" && data.mode === "admin" ? <SchemeDialog schoolId={schoolId} data={data} close={() => setDialog(null)} saved={async (id) => { setDialog(null); setSelectedScheme(id); setSelectedBatch(null); await refresh(); }} /> : null}
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function act(action: "review" | "publish" | "cancel") {
    setBusy(action); setError("");
    try { await reportBatchAction(schoolId, detail.batch.id, action, detail.batch.revision, note); setNote(""); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); }
  }
  return <div className="report-batch"><header><div><small>{detail.batch.class_name} · {detail.batch.term_name}</small><h2>{detail.batch.scheme_name}</h2><p>Release {detail.batch.sequence} · Generated {date(detail.batch.generated_at)}</p></div><i className={`report-status report-status--${detail.batch.status}`}>{nice(detail.batch.status)}</i></header>
    <div className="report-policy-facts"><span><small>LEARNERS</small><strong>{detail.students.length}</strong></span><span><small>COMPLETE</small><strong>{detail.students.filter((item) => item.outcome === "complete").length}</strong></span><span><small>INCOMPLETE</small><strong>{detail.students.filter((item) => item.outcome === "incomplete").length}</strong></span></div>
    {detail.batch.correction_reason ? <p className="report-correction">Correction: {detail.batch.correction_reason}</p> : null}{error ? <p className="report-error">{error}</p> : null}
    {portal === "principal" && ["draft", "reviewed"].includes(detail.batch.status) ? <div className="report-review-bar"><input aria-label="Review or publication note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required note" />{detail.batch.status === "draft" ? <button disabled={Boolean(busy) || note.trim().length < 3} onClick={() => void act("review")}>{busy === "review" ? "Reviewing…" : "Review batch"}</button> : <button disabled={Boolean(busy) || note.trim().length < 3} onClick={() => void act("publish")}>{busy === "publish" ? "Publishing…" : "Publish reports"}</button>}</div> : null}
    <div className="report-learners">{detail.students.map((student) => <LearnerReport key={`${student.id}-${student.comment_revision}`} portal={portal} schoolId={schoolId} batch={detail} student={student} refresh={refresh} />)}</div>
  </div>;
}

function LearnerReport({ portal, schoolId, batch, student, refresh }: { portal: "principal" | "teacher"; schoolId: string; batch: ReportBatchDetail; student: ReportBatchDetail["students"][number]; refresh: () => Promise<void> }) {
  const [teacherComment, setTeacherComment] = useState(student.class_teacher_comment);
  const [principalComment, setPrincipalComment] = useState(student.principal_comment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subjects = batch.subjects.filter((item) => item.report_student_id === student.id);
  async function save() {
    setBusy(true); setError("");
    try { await updateReportComments(schoolId, batch.batch.id, student.student_id, { expected_revision: student.comment_revision, class_teacher_comment: teacherComment, principal_comment: principalComment }); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <article><header><span className="report-roll">{student.roll_number ?? "–"}</span><div><strong>{student.first_name} {student.last_name}</strong><small>{student.admission_number}</small></div><span className={`report-outcome report-outcome--${student.outcome}`}>{nice(student.outcome)}</span><b>{student.overall_percentage ?? "—"}{student.overall_percentage ? "%" : ""}<small>{student.overall_grade}</small></b></header>
    <div className="report-subject-grid">{subjects.map((subject) => <span key={subject.id}><i style={{ background: subject.color }} /><strong>{subject.subject_name}</strong><b>{subject.percentage ? `${subject.percentage}%` : nice(subject.outcome)}</b><small>{subject.grade}{subject.passed === false ? " · Below pass" : ""}</small></span>)}</div>
    {batch.batch.status === "draft" ? <div className="report-comments"><label>Class teacher remark<textarea rows={2} value={teacherComment} onChange={(event) => setTeacherComment(event.target.value)} /></label>{portal === "principal" ? <label>Principal remark<textarea rows={2} value={principalComment} onChange={(event) => setPrincipalComment(event.target.value)} /></label> : null}<button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save remarks"}</button>{error ? <p>{error}</p> : null}</div> : student.class_teacher_comment || student.principal_comment ? <div className="report-read-comments">{student.class_teacher_comment ? <p><b>Class teacher</b>{student.class_teacher_comment}</p> : null}{student.principal_comment ? <p><b>Principal</b>{student.principal_comment}</p> : null}</div> : null}
  </article>;
}

function SchemeDialog({ schoolId, data, close, saved }: { schoolId: string; data: Extract<AcademicReportWorkspace, { mode: "admin" }>; close: () => void; saved: (id: string) => Promise<void> }) {
  const [bands, setBands] = useState([{ code: "F", label: "Needs support", min: "0", max: "39.99" }, { code: "E", label: "Emerging", min: "40", max: "49.99" }, { code: "D", label: "Developing", min: "50", max: "59.99" }, { code: "C", label: "Satisfactory", min: "60", max: "69.99" }, { code: "B", label: "Good", min: "70", max: "79.99" }, { code: "A", label: "Excellent", min: "80", max: "89.99" }, { code: "A+", label: "Outstanding", min: "90", max: "100" }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { const result = await createGradingScheme(schoolId, { term_id: form.get("term_id"), class_section_id: form.get("class_section_id"), name: form.get("name"), code: form.get("code"), absence_treatment: form.get("absence_treatment"), review_mode: form.get("review_mode"), bands: bands.map((band) => ({ code: band.code, label: band.label, minimum_percentage: Number(band.min), maximum_percentage: Number(band.max) })) }); await saved(result.id); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <div className="report-dialog-backdrop"><section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="scheme-title"><header><h2 id="scheme-title">New grading scheme</h2><button onClick={close} aria-label="Close"><X /></button></header><form onSubmit={(event) => void submit(event)}><div className="report-form-grid"><label>Term<select name="term_id" required>{data.references.terms.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.academic_year}</option>)}</select></label><label>Class<select name="class_section_id" required>{data.references.classes.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.academic_year}</option>)}</select></label><label>Name<input name="name" required placeholder="Term 1 report" /></label><label>Code<input name="code" required placeholder="TERM1-REPORT" /></label><label>Absent result<select name="absence_treatment"><option value="incomplete">Keep report incomplete</option><option value="zero">Count as zero</option></select></label><label>Review<select name="review_mode"><option value="independent">Independent reviewer</option><option value="owner_review">Owner review</option></select></label></div><fieldset><legend>Grade bands</legend>{bands.map((band, index) => <div className="report-band-row" key={`${band.code}-${index}`}><input aria-label={`Grade code ${index + 1}`} value={band.code} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /><input aria-label={`Grade label ${index + 1}`} value={band.label} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /><input aria-label={`Minimum ${index + 1}`} type="number" step="0.01" value={band.min} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, min: event.target.value } : item))} /><input aria-label={`Maximum ${index + 1}`} type="number" step="0.01" value={band.max} onChange={(event) => setBands((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, max: event.target.value } : item))} /></div>)}</fieldset>{error ? <p className="report-error">{error}</p> : null}<footer><button type="button" className="is-secondary" onClick={close}>Cancel</button><button disabled={busy}>{busy ? "Creating…" : "Create scheme"}</button></footer></form></section></div>;
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
