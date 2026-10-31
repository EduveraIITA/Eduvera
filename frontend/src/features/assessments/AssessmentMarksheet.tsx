import { CheckCircle2, Printer, ShieldCheck } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { MarksheetDocumentHeader } from "../academic-reports/MarksheetDocumentHeader";
import type { FamilyResults } from "./api";
import { PolicyConfigurationDetails } from "../academic-reports/GradingPolicies";
import { assessmentPrimaryResult, policyDescription } from "../academic-reports/resultPresentation";

const nice = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const publishedDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

export function AssessmentMarksheet({ result, data, printing, onPrint }: {
  result: FamilyResults["results"][number];
  data: FamilyResults;
  printing: boolean;
  onPrint: () => void;
}) {
  const studentName = `${data.student.first_name} ${data.student.last_name}`;
  const historicalClass = result.class_name ?? "Not recorded";
  const scored = result.outcome === "scored" && result.marks !== null && Number.isFinite(Number(result.marks)) && Number(result.maximum_marks) > 0;
  const percentage = scored ? Number(result.marks) / Number(result.maximum_marks) * 100 : null;
  const term = result.term_name.includes(result.academic_year) ? result.term_name : `${result.term_name} · ${result.academic_year}`;
  const reference = result.publication_id.slice(0, 8).toUpperCase();
  const policy = result.result_policy;
  const format = policy?.configuration.result_format;
  const primary = assessmentPrimaryResult(result);
  return <article className={`marksheet assessment-record-marksheet result-document${printing ? " is-print-target" : ""}`} aria-labelledby={`assessment-marksheet-${result.id}`}>
    <MarksheetDocumentHeader kind="assessment" />
    <div className="marksheet__title"><div className="marksheet__title-copy"><span>{term}</span><h2 id={`assessment-marksheet-${result.id}`}>{result.title}</h2><p className="marksheet__learner-context">{studentName}</p>{result.sequence > 1 ? <em>Corrected release</em> : null}</div></div>
    <div className="marksheet__summary" aria-label="Assessment result">
      {policy ? <><span><small>{primary.label}</small><strong>{primary.value}</strong>{primary.secondary ? <em>Grade {primary.secondary}</em> : null}</span><span><small>Result</small><strong>{nice(result.outcome)}</strong><em>{nice(result.assessment_kind)}</em></span></> : <><span><small>Marks</small><strong>{scored ? result.marks : "—"}</strong><em>{scored ? `of ${result.maximum_marks}` : nice(result.outcome)}</em></span>
      <span><small>Percentage</small><strong>{percentage === null ? "—" : `${percentage.toFixed(2)}%`}</strong></span>
      <span><small>Result</small><strong>{result.grade || nice(result.outcome)}</strong><em>{nice(result.assessment_kind)}</em></span></>}
    </div>
    <section className="marksheet__subject-section" aria-label="Subject breakdown"><h3>Subjects</h3>
    <div className={`marksheet__subjects${format === "grade" ? " marksheet__subjects--grade" : ""}`} role="table" aria-label="Subject results">
      <div className="marksheet__subject-head" role="row"><span role="columnheader">Subject</span>{format !== "grade" ? <span role="columnheader">{format === "gpa" ? "Points" : "Score"}</span> : null}<span role="columnheader">Grade</span><span role="columnheader">Status</span></div>
      <div className="marksheet__subject-row" role="row"><span role="cell"><b>{result.subject_name}</b></span>{format !== "grade" ? <strong role="cell"><span className="marksheet__mobile-label" aria-hidden="true">{format === "gpa" ? "Points " : "Score "}</span>{policy ? primary.value : scored ? `${result.marks}/${result.maximum_marks}` : "—"}</strong> : null}<b role="cell"><span className="marksheet__mobile-label" aria-hidden="true">Grade </span>{result.grade || "—"}</b><em role="cell" className={`is-${result.outcome}`}><span className="marksheet__mobile-label sr-only">Status </span>{nice(result.outcome)}</em></div>
    </div></section>
    {result.feedback ? <section className="marksheet__remarks" aria-label="Teacher remarks"><h3>Remarks</h3><div><p><b>Teacher</b>{result.feedback}</p></div></section> : null}
    <details className="marksheet__record-details" open={printing || undefined}><InfoSummary>Record details</InfoSummary><dl className="marksheet__identity"><div><dt>Student</dt><dd>{studentName}</dd></div>{policy ? <div><dt>Original marks</dt><dd>{scored ? `${result.marks} / ${result.maximum_marks}` : nice(result.outcome)}</dd></div> : null}<div><dt>Class</dt><dd>{historicalClass}</dd></div><div><dt>Admission no.</dt><dd>{data.student.admission_number}</dd></div><div><dt>Published</dt><dd>{publishedDate(result.published_at)}</dd></div><div><dt>Reference</dt><dd>{reference}</dd></div><div><dt>Release</dt><dd>{result.sequence}</dd></div><div><dt>Cycle</dt><dd>{result.cycle_name}</dd></div><div><dt>Assessment type</dt><dd>{nice(result.assessment_kind)}</dd></div></dl>{policy ? <div className="marksheet__policy"><h3>Grading policy</h3><p>{policy.name} · Version {policy.version} · {policyDescription(policy)}</p><PolicyConfigurationDetails configuration={policy.configuration} />{format === "gpa" ? <p>These grade points describe this assessment. SGPA and CGPA are calculated in term reports from course credits.</p> : null}</div> : null}<footer className="marksheet__verification"><ShieldCheck size={18} aria-hidden="true" /><span>Published school record</span><CheckCircle2 size={18} aria-hidden="true" /></footer></details>
    <button type="button" className="marksheet__print" onClick={onPrint}><Printer size={17} aria-hidden="true" />Print / save marksheet</button>
  </article>;
}
