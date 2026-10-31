import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { activateGradingPolicy, createGradingPolicy, type GradingPolicy, type GradingPolicyConfiguration } from "./api";

export function GradingPolicies({ schoolId, policies, refresh, onCreate, onRevise, readOnly = false }: { schoolId: string; policies: GradingPolicy[]; refresh: () => Promise<void>; onCreate: () => void; onRevise?: (policy: GradingPolicy) => void; readOnly?: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function activate(policy: GradingPolicy) {
    if (readOnly) return;
    setBusy(policy.id); setError("");
    try { await activateGradingPolicy(schoolId, policy.id, policy.revision, "Grade bands, calculation and result format reviewed."); await refresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  }
  return <section className="grading-policies" aria-label="Grading policies">
    <header><div><h2>Grading policies</h2><p>Define how assessments and reports show results.</p></div>{!readOnly ? <button className="workspace-add-link" type="button" aria-label="New grading policy" onClick={onCreate}><Plus size={20} /></button> : null}</header>
    {error ? <p className="report-error" role="alert">{error}</p> : null}
    {policies.length ? policies.map((policy) => <article key={policy.id} className="grading-policy">
      <div className="grading-policy__heading"><div><h3>{policy.name}</h3><p>{policy.code} · Version {policy.version}</p></div><span className={`report-status report-status--${policy.status}`}>{policy.status === "active" ? "Active" : "Draft"}</span></div>
      <p className="grading-policy__format">{policy.configuration.result_format === "gpa" ? `${policy.configuration.grade_point_scale}-point GPA` : policy.configuration.result_format === "grade" ? "Grades" : "Percentage"} · {policy.configuration.aggregation === "credit_weighted" ? "Credit weighted" : "Equal subject weight"}</p>
      <details><InfoSummary>Calculation and grade bands</InfoSummary><PolicyConfigurationDetails configuration={policy.configuration} /></details>
      {!readOnly && onRevise ? <button className="report-add-component" type="button" disabled={Boolean(busy)} onClick={() => onRevise(policy)}>Create new version</button> : null}
      {!readOnly && policy.status === "draft" ? <div className="report-primary-actions"><p>Activation freezes this version for future assessments and reports.</p><button disabled={Boolean(busy)} type="button" onClick={() => void activate(policy)}>{busy === policy.id ? "Activating…" : "Activate policy"}</button></div> : null}
    </article>) : <p className="report-empty">Create a grading policy, review its calculation, then activate it.</p>}
  </section>;
}

export function PolicyConfigurationDetails({ configuration }: { configuration: GradingPolicyConfiguration }) {
  return <div className="grading-policy__details">
    <p>{configuration.aggregation === "credit_weighted" ? configuration.result_format === "gpa" ? "SGPA = total of course credits × grade points, divided by total included credits." : "Overall result = total of subject credits × subject percentages, divided by total included credits." : "Overall percentage is the mean of included subject percentages."} {configuration.result_format === "grade" ? "The overall grade comes from that percentage’s band." : ""}</p>
    <p>Each normalized percentage is rounded to two decimals before matching a grade band. Final numbers show {configuration.decimal_places} decimal {configuration.decimal_places === 1 ? "place" : "places"}. Absence {configuration.absence_treatment === "zero" ? "counts as zero" : "keeps the report incomplete"}; exempt results are excluded.</p>
    {configuration.result_format === "gpa" ? <p>{configuration.gpa_failure_treatment === "withhold" ? "SGPA is withheld while any included course is below pass." : "Failed courses keep their credits and mapped points in the calculation."} CGPA combines published course results within the same programme; repeated course codes use the latest term’s attempt, including a failed or incomplete retake.</p> : null}
    <div className={`grading-policy__bands${configuration.result_format === "gpa" ? " grading-policy__bands--points" : ""}`} role="table" aria-label="Policy grade bands"><div role="row"><span role="columnheader">Grade</span><span role="columnheader">Percentage</span>{configuration.result_format === "gpa" ? <span role="columnheader">Points</span> : null}<span role="columnheader">Pass</span></div>{configuration.bands.slice().reverse().map((band) => <div role="row" key={band.code}><span role="cell"><strong>{band.code}</strong> · {band.label}</span><span role="cell">{band.minimum_percentage}–{band.maximum_percentage}%</span>{configuration.result_format === "gpa" ? <span role="cell">{band.grade_points ?? "—"}</span> : null}<span role="cell">{band.passed ? "Yes" : "No"}</span></div>)}</div>
  </div>;
}

type BandDraft = { code: string; label: string; min: string; max: string; points: string; passed: boolean };
const initialBands: BandDraft[] = [
  { code: "F", label: "Below pass", min: "0", max: "39.99", points: "0", passed: false },
  { code: "D", label: "Pass", min: "40", max: "49.99", points: "4", passed: true },
  { code: "C", label: "Satisfactory", min: "50", max: "59.99", points: "5", passed: true },
  { code: "B", label: "Good", min: "60", max: "69.99", points: "6", passed: true },
  { code: "B+", label: "Very good", min: "70", max: "79.99", points: "8", passed: true },
  { code: "A", label: "Excellent", min: "80", max: "89.99", points: "9", passed: true },
  { code: "A+", label: "Outstanding", min: "90", max: "100", points: "10", passed: true },
];

export function GradingPolicyDialog({ schoolId, close, saved, sourcePolicy }: { schoolId: string; close: () => void; saved: () => Promise<void>; sourcePolicy?: GradingPolicy | null }) {
  const [step, setStep] = useState<"setup" | "bands" | "review">("setup");
  const [name, setName] = useState(sourcePolicy?.name ?? "");
  const [code, setCode] = useState(sourcePolicy?.code ?? "");
  const [codeEdited, setCodeEdited] = useState(Boolean(sourcePolicy));
  const [format, setFormat] = useState<GradingPolicyConfiguration["result_format"]>(sourcePolicy?.configuration.result_format ?? "percentage");
  const [scale, setScale] = useState(String(sourcePolicy?.configuration.grade_point_scale ?? 10));
  const [precision, setPrecision] = useState(String(sourcePolicy?.configuration.decimal_places ?? 2));
  const [aggregation, setAggregation] = useState<GradingPolicyConfiguration["aggregation"]>(sourcePolicy?.configuration.aggregation ?? "equal");
  const [absence, setAbsence] = useState<GradingPolicyConfiguration["absence_treatment"]>(sourcePolicy?.configuration.absence_treatment ?? "incomplete");
  const [failure, setFailure] = useState<GradingPolicyConfiguration["gpa_failure_treatment"]>(sourcePolicy?.configuration.gpa_failure_treatment ?? "include");
  const [bands, setBands] = useState<BandDraft[]>(sourcePolicy ? sourcePolicy.configuration.bands.map((band) => ({ code: band.code, label: band.label, min: String(band.minimum_percentage), max: String(band.maximum_percentage), points: String(band.grade_points ?? 0), passed: band.passed })) : initialBands);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),summary") ?? []).filter((element) => !element.closest("[hidden]"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, [close, busy]);
  useEffect(() => { if (step !== "setup") headingRef.current?.focus(); }, [step]);
  const configuration: GradingPolicyConfiguration = { schema_version: 1, result_format: format, grade_point_scale: format === "gpa" ? Number(scale) : null, decimal_places: Number(precision), aggregation, absence_treatment: absence, exemption_treatment: "exclude", gpa_failure_treatment: failure, bands: bands.map((band) => ({ code: band.code.trim().toUpperCase(), label: band.label.trim(), minimum_percentage: Number(band.min), maximum_percentage: Number(band.max), grade_points: format === "gpa" ? Number(band.points) : null, passed: band.passed })) };
  function updateBand(index: number, patch: Partial<BandDraft>) { setBands((current) => current.map((band, itemIndex) => itemIndex === index ? { ...band, ...patch } : band)); setError(""); }
  function advance() {
    const controls = formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".report-dialog-stage:not([hidden]) input, .report-dialog-stage:not([hidden]) select");
    if (!controls || Array.from(controls).some((control) => !control.reportValidity())) return;
    if (step === "bands") {
      const sorted = [...configuration.bands].sort((a, b) => a.minimum_percentage - b.minimum_percentage);
      const codes = new Set(sorted.map((band) => band.code));
      if (!sorted.length || sorted[0]!.minimum_percentage !== 0 || sorted.at(-1)!.maximum_percentage !== 100 || codes.size !== sorted.length || sorted.some((band, index) => band.maximum_percentage < band.minimum_percentage || index > 0 && Math.abs(band.minimum_percentage - sorted[index - 1]!.maximum_percentage - .01) > .001)) { setError("Use unique grade codes and percentage ranges covering 0–100 with no gaps or overlaps."); return; }
    }
    setError(""); setStep(step === "setup" ? "bands" : "review");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "review") { advance(); return; }
    if (busy) return;
    setBusy(true); setError("");
    try { await createGradingPolicy(schoolId, { name, code, configuration }); await saved(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const example = configuration.bands.find((band) => 82.5 >= band.minimum_percentage && 82.5 <= band.maximum_percentage);
  return <div className="report-dialog-backdrop"><section ref={dialogRef} className="report-dialog report-scheme-dialog grading-policy-dialog" role="dialog" aria-modal="true" aria-labelledby="grading-policy-title"><header><h2 id="grading-policy-title">{sourcePolicy ? "New policy version" : "New grading policy"}</h2><button type="button" disabled={busy} onClick={close} aria-label="Close grading policy"><X /></button></header>
    <div className="grading-policy-steps" aria-label="Policy setup progress"><span aria-current={step === "setup" ? "step" : undefined}>1 · Setup</span><span aria-current={step === "bands" ? "step" : undefined}>2 · Bands</span><span aria-current={step === "review" ? "step" : undefined}>3 · Review</span></div>
    <form noValidate ref={formRef} onSubmit={(event) => void submit(event)}>
      <section className="report-dialog-stage" hidden={step !== "setup"}><div className="report-stage-heading"><h3>How should results be shown?</h3><p>{sourcePolicy ? `Starts from version ${sourcePolicy.version}. Existing assessments and published reports keep their original policy.` : "This policy can be reused by assessments and report schemes."}</p></div><div className="report-form-grid">
        <label>Policy name<input required minLength={2} maxLength={120} value={name} onChange={(event) => { setName(event.target.value); if (!codeEdited) setCode(event.target.value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 32).replace(/^-|-$/g, "")); }} /></label>
        <label>Policy code<input required readOnly={Boolean(sourcePolicy)} minLength={2} maxLength={32} value={code} onChange={(event) => { setCodeEdited(true); setCode(event.target.value.toUpperCase()); }} /></label>
        <label>Result format<select value={format} onChange={(event) => { const value = event.target.value as typeof format; setFormat(value); if (value === "gpa") setAggregation("credit_weighted"); }}><option value="percentage">Percentage</option><option value="grade">Grade</option><option value="gpa">Grade points / GPA</option></select></label>
        {format === "gpa" ? <label>Grade point scale<input type="number" min="0.0001" max="100" step="0.0001" required value={scale} onChange={(event) => setScale(event.target.value)} /></label> : null}
        <label>Decimal places<select value={precision} onChange={(event) => setPrecision(event.target.value)}>{[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Subject weighting<select value={aggregation} onChange={(event) => setAggregation(event.target.value as typeof aggregation)}><option value="equal" disabled={format === "gpa"}>Equal subject weight</option><option value="credit_weighted">Credit weighted</option></select></label>
        <label>Absent result<select value={absence} onChange={(event) => setAbsence(event.target.value as typeof absence)}><option value="incomplete">Keep report incomplete</option><option value="zero">Count as zero</option></select></label>
        {format === "gpa" ? <label>Failed courses<select value={failure} onChange={(event) => setFailure(event.target.value as typeof failure)}><option value="include">Include credits and mapped points</option><option value="withhold">Withhold GPA until all pass</option></select></label> : null}
      </div><p className="report-form-help">Results are entered as marks. Grades and points come from the bands you configure next.</p></section>
      <section className="report-dialog-stage" hidden={step !== "bands"}><div className="report-stage-heading"><h3 ref={step === "bands" ? headingRef : undefined} tabIndex={-1}>Grade bands</h3><p>Review every range and pass decision. The starting bands are editable.</p></div><div className="report-band-editor">{bands.map((band, index) => <div className="report-band-row grading-policy-band" key={index}>
        <label><span>Grade</span><input aria-label={`Grade code ${index + 1}`} required maxLength={24} value={band.code} onChange={(event) => updateBand(index, { code: event.target.value })} /></label><label><span>Meaning</span><input aria-label={`Grade label ${index + 1}`} required maxLength={80} value={band.label} onChange={(event) => updateBand(index, { label: event.target.value })} /></label>
        <div className="report-band-range"><label><span>From %</span><input aria-label={`Minimum ${index + 1}`} required type="number" min="0" max="100" step="0.01" value={band.min} onChange={(event) => updateBand(index, { min: event.target.value })} /></label><label><span>To %</span><input aria-label={`Maximum ${index + 1}`} required type="number" min="0" max="100" step="0.01" value={band.max} onChange={(event) => updateBand(index, { max: event.target.value })} /></label></div>
        {format === "gpa" ? <label className="grading-policy-band__points"><span>Points</span><input aria-label={`Grade points ${index + 1}`} required type="number" min="0" max={scale} step="0.0001" value={band.points} onChange={(event) => updateBand(index, { points: event.target.value })} /></label> : null}
        <label className="grading-policy-band__pass"><input aria-label={`Passing grade ${index + 1}`} type="checkbox" checked={band.passed} onChange={(event) => updateBand(index, { passed: event.target.checked })} /><span>Pass</span></label><button className="grading-policy-band__remove" type="button" disabled={bands.length === 1} aria-label={`Remove grade ${index + 1}`} onClick={() => setBands((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={18} /></button>
      </div>)}</div><button className="report-add-component" type="button" disabled={bands.length >= 30} onClick={() => setBands((current) => [...current, { code: "", label: "", min: "", max: "", points: "", passed: true }])}><Plus size={16} />Add grade</button></section>
      <section className="report-dialog-stage" hidden={step !== "review"}><div className="report-stage-heading"><h3 ref={step === "review" ? headingRef : undefined} tabIndex={-1}>Review policy</h3><p>{name} · {code}</p></div><PolicyConfigurationDetails configuration={configuration} /><div className="grading-policy-example"><strong>Calculation example</strong><p>66 of 80 marks = 82.50%{example ? ` → ${example.code}${format === "gpa" ? ` → ${Number(example.grade_points).toFixed(Number(precision))} / ${scale} points` : ""}` : ""}.</p><p>{format === "gpa" ? "A term report weights mapped grade points by course credits. CGPA includes the selected programme’s earlier published courses." : "A report combines subject percentages using the selected weighting, then applies the overall grade band."}</p></div><p className="report-form-help">Create a draft now. Activate it after review to make it available for use.</p></section>
      {error ? <p className="report-error" role="alert">{error}</p> : null}<footer><button className="is-secondary" type="button" disabled={busy} onClick={step === "setup" ? close : () => { setError(""); setStep(step === "review" ? "bands" : "setup"); }}>{step === "setup" ? "Cancel" : "Back"}</button>{step === "review" ? <button key="create-policy" type="submit" disabled={busy}>{busy ? "Creating…" : "Create policy"}</button> : <button key={step} type="button" onClick={advance}>Continue</button>}</footer>
    </form></section></div>;
}
