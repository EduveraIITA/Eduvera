import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { createGradingScheme, type AcademicReportWorkspace } from "./api";
import { PolicyConfigurationDetails } from "./GradingPolicies";

export function ReportSchemeDialog({ schoolId, data, close, saved, onCreatePolicy }: { schoolId: string; data: Extract<AcademicReportWorkspace, { mode: "admin" }>; close: () => void; saved: (id: string) => Promise<void>; onCreatePolicy: () => void }) {
  const policies = (data.policies ?? []).filter((policy) => policy.status === "active");
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const policy = policies.find((item) => item.id === policyId);
  const [termId, setTermId] = useState(data.references.terms[0]?.id ?? "");
  const selectedTerm = data.references.terms.find((term) => term.id === termId);
  const eligibleClasses = data.references.classes.filter((item) => item.academic_year === selectedTerm?.academic_year);
  const [classId, setClassId] = useState(() => data.references.classes.find((item) => item.academic_year === data.references.terms[0]?.academic_year)?.id ?? "");
  const selectedClass = eligibleClasses.find((item) => item.id === classId) ?? eligibleClasses[0];
  const canCreate = Boolean(policy && selectedTerm && selectedClass);
  const [step, setStep] = useState<"details" | "review">("details");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),summary") ?? []).filter((item) => !item.closest("[hidden]") && (!item.closest("details") || item.tagName === "SUMMARY" || item.closest("details")?.open));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [close, busy]);
  useEffect(() => { if (step === "review") headingRef.current?.focus(); }, [step]);
  function selectTerm(id: string) {
    const term = data.references.terms.find((item) => item.id === id);
    const classes = data.references.classes.filter((item) => item.academic_year === term?.academic_year);
    setTermId(id);
    setClassId(classes.find((item) => item.id === selectedClass?.id)?.id ?? classes[0]?.id ?? "");
    setError("");
  }
  function review() { if (canCreate && formRef.current?.reportValidity()) { setError(""); setStep("review"); } }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "details") { review(); return; }
    if (busy || !policy || !selectedTerm || !selectedClass || !formRef.current) return;
    const form = new FormData(formRef.current);
    setBusy(true); setError("");
    try {
      const result = await createGradingScheme(schoolId, { term_id: selectedTerm.id, class_section_id: selectedClass.id, name, code, grading_policy_id: policy.id, review_mode: form.get("review_mode"), absence_treatment: policy.configuration.absence_treatment, programme_key: policy.configuration.result_format === "gpa" ? form.get("programme_key") : null, term_index: policy.configuration.result_format === "gpa" ? Number(form.get("term_index")) : null });
      await saved(result.id);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="report-dialog-backdrop"><section ref={dialogRef} className="report-dialog report-scheme-dialog" role="dialog" aria-modal="true" aria-labelledby="scheme-title"><header><h2 id="scheme-title">New report scheme</h2><button type="button" disabled={busy} onClick={close} aria-label="Close"><X /></button></header>
    {!policies.length ? <div className="report-dialog-stage"><div className="report-stage-heading"><h3>Set up a grading policy first</h3><p>An active policy supplies the result format, grade bands and calculation.</p></div><button className="report-add-component" type="button" onClick={onCreatePolicy}>Create grading policy</button></div> : <><nav className="report-dialog-steps" aria-label="Scheme setup progress"><button type="button" className={step === "details" ? "is-active" : "is-complete"} disabled={busy} onClick={() => setStep("details")}><b>1</b><span>Details</span></button><i /><button type="button" className={step === "review" ? "is-active" : ""} disabled={busy || !canCreate} onClick={review}><b>2</b><span>Review</span></button></nav>
      <form ref={formRef} onSubmit={(event) => void submit(event)}><section className="report-dialog-stage" hidden={step !== "details"}><div className="report-stage-heading"><h3>Report setup</h3><p>Choose the learners, term and grading policy.</p></div><div className="report-form-grid">
        <label>Term<select name="term_id" required value={termId} disabled={!data.references.terms.length} onChange={(event) => selectTerm(event.target.value)}>{!data.references.terms.length ? <option value="">No active terms</option> : data.references.terms.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.academic_year}</option>)}</select></label>
        <label>Class<select name="class_section_id" required value={selectedClass?.id ?? ""} disabled={!eligibleClasses.length} aria-describedby={!selectedClass ? "report-scheme-class-help" : undefined} onChange={(event) => setClassId(event.target.value)}>{!eligibleClasses.length ? <option value="">No classes for this year</option> : eligibleClasses.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.academic_year}</option>)}</select></label>
        <label>Scheme name<input required minLength={2} maxLength={120} name="name" value={name} onChange={(event) => { setName(event.target.value); if (!codeEdited) setCode(event.target.value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 32).replace(/^-|-$/g, "")); }} /></label>
        <label>Code<input required minLength={2} maxLength={32} name="code" value={code} onChange={(event) => { setCodeEdited(true); setCode(event.target.value.toUpperCase()); }} /></label>
        <label>Grading policy<select required value={policyId} onChange={(event) => setPolicyId(event.target.value)}>{policies.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>
        <label>Approval<select name="review_mode"><option value="independent">Independent reviewer</option><option value="owner_review">Owner review</option></select></label>
        {policy?.configuration.result_format === "gpa" ? <><label>Programme key<input required name="programme_key" maxLength={80} placeholder="MTECH-DATA-2026" /><small>Use the same key across this programme’s terms.</small></label><label>Term number<input required name="term_index" type="number" min="1" step="1" placeholder="1" /><small>Orders the published courses used for CGPA.</small></label></> : null}
      </div>{policy ? <details className="report-policy-disclosure"><InfoSummary>Selected policy</InfoSummary><p>{policy.name} · Version {policy.version}</p><PolicyConfigurationDetails configuration={policy.configuration} /></details> : null}</section>
      <section className="report-dialog-stage" hidden={step !== "review"}><div className="report-stage-heading"><h3 ref={headingRef} tabIndex={-1}>Review scheme</h3><p>{name} · {code}</p></div><p>{selectedClass?.name} · {selectedTerm?.name} · {selectedTerm?.academic_year}</p>{policy ? <><p>Uses <strong>{policy.name}</strong>, version {policy.version}. Its calculation is frozen with this report scheme.</p><PolicyConfigurationDetails configuration={policy.configuration} /><p className="report-form-help">Next, map published assessments to subjects and review the scheme before activation.</p></> : null}</section>
      {!selectedClass ? <p id="report-scheme-class-help" className="report-dialog-stage report-form-help" role="status">{selectedTerm ? `No classes are available for ${selectedTerm.academic_year}. Choose another term or set up a class for this academic year before continuing.` : "Add an active academic term before creating a report scheme."}</p> : null}{error ? <p className="report-error" role="alert">{error}</p> : null}<footer><button className="is-secondary" type="button" disabled={busy} onClick={step === "details" ? close : () => setStep("details")}>{step === "details" ? "Cancel" : "Back"}</button>{step === "details" ? <button key="continue" type="button" disabled={busy || !canCreate} onClick={review}>Continue</button> : <button key="create" type="submit" disabled={busy || !canCreate}>{busy ? "Creating…" : "Create scheme"}</button>}</footer></form>
    </>}
  </section></div>;
}
