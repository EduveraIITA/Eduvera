import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ProductIcon } from "../../components/ProductIcon";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { FamilyReportMarksheet } from "../academic-reports/AcademicReportWorkspacePage";
import type { FamilyReportCards } from "../academic-reports/api";
import { assessmentPrimaryResult, reportPrimaryResult } from "../academic-reports/resultPresentation";
import { portalReturnState } from "../navigation/portalReturnState";
import { AssessmentMarksheet } from "./AssessmentMarksheet";
import type { FamilyResults } from "./api";
import "./assessments.css";
import "./family-results.css";

const PAGE_SIZE = 10;
const recordParams = ["assessment_id", "publication_id", "report_batch_id", "attention_notification_id"];
const nice = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const publishedDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
const termLabel = (term: string, year: string) => term.includes(year) ? term : `${term} · ${year}`;
type Record = { key: string; type: "report"; report: FamilyReportCards["reports"][number] } | { key: string; type: "assessment"; result: FamilyResults["results"][number] };

export function FamilyResultsPage({ portal, presentation = "legacy", data, reportCards, children, onSelect, sourceNotice }: {
  portal?: "parent" | "student";
  presentation?: "legacy" | "workspace";
  data: FamilyResults;
  reportCards?: FamilyReportCards;
  children: Array<{ id: string; user: { display_name: string }; current_enrollment: { grade: string; section: string }; avatar_url: string }>;
  onSelect: (id: string) => void;
  sourceNotice?: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const currentHref = `${location.pathname}${location.search}${location.hash}`;
  const hasRecordTarget = ["assessment_id", "publication_id", "report_batch_id"].some((key) => params.has(key));
  const assessmentId = params.get("assessment_id");
  const publicationId = params.get("publication_id");
  const reportId = params.get("report_batch_id");
  const selectedReport = reportId && !assessmentId && !publicationId ? reportCards?.reports.find((report) => report.batch_id === reportId) : undefined;
  const selectedAssessment = assessmentId && publicationId && !reportId ? data.results.find((result) => result.id === assessmentId && result.publication_id === publicationId) : undefined;
  const selectedKey = selectedReport ? `report-${selectedReport.batch_id}` : selectedAssessment ? `assessment-${selectedAssessment.id}` : null;
  const years = Array.from(new Set([...(reportCards?.reports.map((report) => report.academic_year) ?? []), ...data.results.map((result) => result.academic_year)])).filter(Boolean).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const requestedYear = params.get("result_year");
  const year = requestedYear === "all" || requestedYear && years.includes(requestedYear) ? requestedYear : selectedReport?.academic_year ?? selectedAssessment?.academic_year ?? years[0] ?? "all";
  const requestedKind = params.get("result_kind");
  const kind = requestedKind === "term" || requestedKind === "assessment" ? requestedKind : "all";
  const query = params.get("result_search") ?? "";
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [printing, setPrinting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const searchVisible = searchOpen || Boolean(query);
  const needle = query.trim().toLocaleLowerCase();
  const filteredReports = (reportCards?.reports ?? []).filter((report) => (year === "all" || report.academic_year === year) && (!needle || [report.scheme_name, report.term_name, report.academic_year, ...report.subjects.map((subject) => subject.subject_name)].some((value) => value.toLocaleLowerCase().includes(needle))));
  const filteredAssessments = data.results.filter((result) => (year === "all" || result.academic_year === year) && (!needle || [result.title, result.subject_name, result.cycle_name, result.term_name, result.academic_year, nice(result.assessment_kind)].some((value) => value.toLocaleLowerCase().includes(needle))));
  const representedByTermReport = (result: FamilyResults["results"][number]) => filteredReports.some((report) => report.subjects.some((subject) => subject.assessment_ids?.includes(result.id)));
  const records: Record[] = [
    ...(kind === "assessment" ? [] : filteredReports.map((report) => ({ key: `report-${report.batch_id}`, type: "report" as const, report }))),
    ...(kind === "term" ? [] : filteredAssessments.filter((result) => kind === "assessment" || !representedByTermReport(result)).map((result) => ({ key: `assessment-${result.id}`, type: "assessment" as const, result }))),
  ];
  records.sort((left, right) => {
    const dateFor = (record: Record) => record.type === "report" ? record.report.published_at : record.result.published_at;
    return new Date(dateFor(right)).getTime() - new Date(dateFor(left)).getTime() || left.key.localeCompare(right.key);
  });
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const requestedPage = Number(params.get("result_page") ?? 1);
  const page = Math.min(pageCount, Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const start = (page - 1) * PAGE_SIZE;
  const pageRecords = records.slice(start, start + PAGE_SIZE);
  const listParams = new URLSearchParams(params);
  recordParams.forEach((key) => listParams.delete(key));
  if (hasRecordTarget && !requestedYear && (selectedReport || selectedAssessment)) listParams.set("result_year", year);
  const listHref = `${location.pathname}${listParams.size ? `?${listParams}` : ""}`;
  // A single-surface Area redirects straight back to this library. Unknown
  // history must fall back to the actual Areas list; observed Back still pops
  // the person's previous workspace through PortalPageTitle.
  const backTo = hasRecordTarget ? listHref : presentation === "workspace" ? "/areas" : portal === "parent" ? "/parent/more" : "/student/apps";
  const classLabel = data.student.class_name?.replace(/^Class\s+/i, "") ?? "Current class";
  const studentName = `${data.student.first_name} ${data.student.last_name}`;

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    recordParams.forEach((name) => next.delete(name));
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "result_page") next.delete("result_page");
    setParams(next, { replace: true });
  }
  function recordHref(record: Record) {
    const next = new URLSearchParams(params);
    recordParams.forEach((key) => next.delete(key));
    if (record.type === "report") next.set("report_batch_id", record.report.batch_id);
    else { next.set("assessment_id", record.result.id); next.set("publication_id", record.result.publication_id); }
    return `${location.pathname}?${next}`;
  }
  function changePage(nextPage: number) {
    updateFilter("result_page", String(nextPage));
    window.requestAnimationFrame(() => listRef.current?.focus());
  }
  useEffect(() => {
    if (selectedKey) readerRef.current?.focus({ preventScroll: true });
  }, [selectedKey]);
  useEffect(() => {
    if (!printing) return;
    const finish = () => setPrinting(false);
    window.addEventListener("afterprint", finish, { once: true });
    const frame = window.requestAnimationFrame(() => window.print());
    const fallback = window.setTimeout(finish, 60000);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(fallback); window.removeEventListener("afterprint", finish); };
  }, [printing]);

  const scope = children.length > 1 ? <label className="results-workspace-scope"><span>Viewing</span><select aria-label="Choose learner" value={data.student.id} onChange={(event) => onSelect(event.target.value)}>{children.map((item) => <option key={item.id} value={item.id}>{item.user.display_name} · Grade {item.current_enrollment.grade}{item.current_enrollment.section}</option>)}</select></label> : null;
  const content = <div className={`family-results-page${printing ? " is-printing" : ""}`}>
    {sourceNotice}
    {hasRecordTarget ? selectedKey ? <section ref={readerRef} className="results-reader" aria-label="Published result" id={`attention-${selectedKey}`} tabIndex={-1}>
      {selectedReport && reportCards ? <FamilyReportMarksheet data={reportCards} report={selectedReport} showPrintAction printing={printing} onPrint={() => setPrinting(true)} /> : selectedAssessment ? <AssessmentMarksheet data={data} result={selectedAssessment} printing={printing} onPrint={() => setPrinting(true)} /> : null}
    </section> : <section className="results-empty" role="status"><ProductIcon name="records" size={36} /><h2>Published result unavailable</h2><p>This link does not match an available published record.</p><Link to={listHref}>Back to results</Link></section> : <section className="results-library" aria-label="Published results">
      <div className="results-library__toolbar">
        <label className="results-library__year"><span className="sr-only">Academic year</span><select value={year} onChange={(event) => updateFilter("result_year", event.target.value)}><option value="all">All years</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="results-library__kind"><span className="sr-only">Result type</span><select value={kind} onChange={(event) => updateFilter("result_kind", event.target.value)}><option value="all">All</option><option value="term">Term reports</option><option value="assessment">Assessments</option></select></label>
        <button ref={searchToggleRef} type="button" className="results-library__search-toggle" aria-label="Search results" aria-expanded={searchVisible} onClick={() => { setSearchOpen(true); window.requestAnimationFrame(() => searchRef.current?.focus()); }}><Search size={20} aria-hidden="true" /></button>
      </div>
      {searchVisible ? <div className="results-library__search"><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="results-library-search">Search results</label><input id="results-library-search" ref={searchRef} value={query} onChange={(event) => updateFilter("result_search", event.target.value)} placeholder="Subject, assessment or report" /><button type="button" aria-label="Close search" onClick={() => { updateFilter("result_search", ""); setSearchOpen(false); window.requestAnimationFrame(() => searchToggleRef.current?.focus({ preventScroll: true })); }}><X size={18} aria-hidden="true" /></button></div> : null}
      <div className="results-library__context"><span className="results-library__learner"><strong>{studentName}</strong><span>{classLabel}</span></span><span role="status">{records.length} published {records.length === 1 ? "result" : "results"}</span></div>
      {pageRecords.length ? <div ref={listRef} className="results-record-list" tabIndex={-1} aria-label="Result records">{pageRecords.map((record) => {
        const report = record.type === "report" ? record.report : null;
        const result = record.type === "assessment" ? record.result : null;
        const title = report?.scheme_name ?? result?.title ?? "";
        const term = termLabel(report?.term_name ?? result?.term_name ?? "", report?.academic_year ?? result?.academic_year ?? "");
        const publicationDate = publishedDate(report?.published_at ?? result?.published_at ?? "");
        const corrected = (report?.sequence ?? result?.sequence ?? 1) > 1;
        const primary = report ? reportPrimaryResult(report) : result ? assessmentPrimaryResult(result) : { value: "—", label: "", secondary: "" };
        const score = primary.value;
        const grade = primary.secondary;
        const href = recordHref(record);
        return <Link key={record.key} className={`results-record${record.type === "report" ? " results-record--term" : ""}`} to={href} state={portalReturnState(currentHref, href)} aria-labelledby={`result-title-${record.key}`} aria-describedby={`result-type-${record.key} result-description-${record.key} result-score-${record.key}`}>
          <span className="results-record__icon"><ProductIcon name={record.type === "report" ? "records" : "learning"} size={28} /></span>
          <span className="results-record__copy"><span id={`result-type-${record.key}`} className="results-record__type">{record.type === "report" ? "Term report" : result?.subject_name}</span><strong id={`result-title-${record.key}`}>{title}</strong><span id={`result-description-${record.key}`} className="results-record__meta">{term}<span>Published {publicationDate}{corrected ? " · Corrected" : ""}</span></span></span>
          <span id={`result-score-${record.key}`} className="results-record__result"><strong>{score}</strong>{primary.label === "SGPA" || primary.label === "Grade points" ? <span>{primary.label}</span> : grade && grade !== score ? <span>Grade {grade}</span> : null}{report && report.outcome !== "complete" ? <em>{nice(report.outcome)}</em> : null}</span><ChevronRight className="results-record__arrow" size={18} aria-hidden="true" />
        </Link>;
      })}</div> : <div className="results-empty"><ProductIcon name="learning" size={36} /><h2>{sourceNotice && !data.results.length && !reportCards?.reports.length ? "Results temporarily incomplete" : data.results.length || reportCards?.reports.length ? "No matching results" : "No published results"}</h2>{data.results.length || reportCards?.reports.length ? <p>Try another year, result type or search.</p> : null}</div>}
      {pageCount > 1 ? <nav className="results-pagination" aria-label="Results pages"><button type="button" aria-label="Previous results page" disabled={page === 1} onClick={() => changePage(page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button><span role="status">{start + 1}–{Math.min(start + PAGE_SIZE, records.length)} of {records.length} results</span><button type="button" aria-label="Next results page" disabled={page === pageCount} onClick={() => changePage(page + 1)}><ChevronRight size={18} aria-hidden="true" /></button></nav> : null}
    </section>}
  </div>;
  if (presentation === "workspace") return <OperationsShell active="areas" title="Results & progress" backTo={backTo}>{scope}{content}</OperationsShell>;
  if (portal === "parent") return <ParentShell active="more" pageLabel="Results" child={{ id: data.student.id, name: studentName, grade: classLabel, section: "", board: "", rollNumber: "", avatarUrl: children.find((item) => item.id === data.student.id)?.avatar_url }} selectedChildId={data.student.id} childOptions={children.map((item) => ({ id: item.id, name: item.user.display_name, grade: `Grade ${item.current_enrollment.grade}`, section: item.current_enrollment.section, avatarUrl: item.avatar_url }))} onSelectChild={onSelect} backTo={backTo}>{content}</ParentShell>;
  return <StudentShell activeNav="launcher" pageTitle="Results" backTo={backTo}>{content}</StudentShell>;
}
