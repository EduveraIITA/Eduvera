import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileUp, UserRound } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { InfoSummary } from "../../components/InfoSummary";
import { ApiError } from "../../lib/api";
import { useOptionalAuth } from "../auth/AuthContext";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity } from "../simulation/executionEnvironment";
import { createParticipant, getParticipant } from "./participationApi";
import { checkPeopleImportNames, type PeopleNameCheck, type PeopleNameMatch } from "./peopleBulkApi";
import { readPeopleImportFile } from "./peopleBulkFile";
import { PeopleNamesComposer } from "./PeopleNamesComposer";
import { guessPeopleImportMapping, hasPeopleImportValues, mapPeopleImportRows, parsePeoplePaste, peopleImportCellText, type PeopleImportConnection, type PeopleImportMapping, type PeopleImportRow, type PeopleImportSheet } from "./peopleBulkImport";
import "./people-bulk-add.css";

export interface ReadyCampusPerson { id: string; label: string; affiliations: string[] }
type ReviewRow = PeopleImportRow & { key: string; check?: PeopleNameCheck; decision: "create" | "existing" | "skip" | null; match?: PeopleNameMatch; accepted?: ReadyCampusPerson; attempted: boolean; saveError?: string };
const connectionLabels: Record<string, string> = { learner: "Learner", worker: "Employee", contractor: "Contractor", visitor: "Visitor", other: "Other" };
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toLocaleUpperCase();

export function PeopleBulkAddDialog({ schoolId, onClose, onDone }: { schoolId: string; onClose: () => void; onDone: (people: ReadyCampusPerson[]) => void }) {
  const environment = useExecutionEnvironment();
  const auth = useOptionalAuth();
  const readOnly = environment.mode === "simulation" && (environment.unavailable === true || environment.runStatus === "completed" || environment.runStatus === "stopped");
  const scope = `${auth?.user?.id ?? "unbound"}:${auth?.user?.active_school_id ?? ""}:${schoolId}:${executionEnvironmentIdentity(environment)}`;
  const [initialScope] = useState(scope);
  const currentScope = useRef({ scope, readOnly });
  useLayoutEffect(() => { currentScope.current = { scope, readOnly }; }, [scope, readOnly]);
  const mounted = useRef(true);
  const stop = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);
  const current = () => mounted.current && currentScope.current.scope === initialScope && !currentScope.current.readOnly;
  const [stage, setStage] = useState<"choose" | "file" | "map" | "review" | "result">("choose");
  const [reviewReturn, setReviewReturn] = useState<"choose" | "map">("map");
  const [connection, setConnection] = useState<PeopleImportConnection | "">("");
  const nameFormId = useId();
  const [sheets, setSheets] = useState<PeopleImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<PeopleImportMapping>({ nameColumn: 0, connectionColumn: null, hasHeader: false });
  const [paste, setPaste] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const rowRef = useRef<ReviewRow[]>([]);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "review">("all");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const setWorking = (value: boolean) => { busyRef.current = value; setBusy(value); };
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const heading = useRef<HTMLParagraphElement>(null);
  const reviewList = useRef<HTMLFieldSetElement>(null);
  const reviewFilters = useRef<HTMLDivElement>(null);
  const pendingReviewFocus = useRef<number | null>(null);
  useEffect(() => { const dialog = heading.current?.closest("dialog"); if (stage === "choose") dialog?.querySelector<HTMLTextAreaElement>(".people-names-composer textarea")?.focus({ preventScroll: true }); else heading.current?.focus({ preventScroll: true }); if (dialog) dialog.scrollTop = 0; }, [stage, page]);
  const replaceRows = (next: ReviewRow[]) => { rowRef.current = next; setRows(next); };
  const changeRow = (row: number, values: Partial<ReviewRow>) => {
    const next = rowRef.current.map((item) => item.row === row ? { ...item, ...values } : item);
    const updated = next.find((item) => item.row === row);
    const focusedRow = document.activeElement?.closest("[data-import-row]");
    if (stage === "review" && filter === "review" && updated && !needsReview(updated) && focusedRow?.getAttribute("data-import-row") === String(row)) pendingReviewFocus.current = row;
    replaceRows(next);
  };
  const failure = (cause: unknown) => { if (!current()) return; if (cause instanceof ApiError && [401, 403].includes(cause.status)) setDenied(true); setError(cause instanceof Error ? cause.message : "This could not be completed. Your review is still here."); };
  const close = () => { if (busyRef.current) return; if (rowRef.current.some((row) => row.attempted && !row.accepted) && !window.confirm("Some additions were not confirmed. They may already exist. Retry here to avoid duplicates, or check People before importing them again. Close anyway?")) return; onClose(); };
  const loadSheets = (next: PeopleImportSheet[], name: string) => { if (!next.some((sheet) => sheet.rows.some(hasPeopleImportValues))) throw new Error("No names were found. Choose a populated sheet or paste one name per line."); setSheets(next); const index = Math.max(0, next.findIndex((sheet) => sheet.rows.some(hasPeopleImportValues))); setSheetIndex(index); setMapping(guessPeopleImportMapping(next[index]!)); setFilename(name); setError(""); setStage("map"); };
  const chooseFile = async (file?: File) => { if (!file || busyRef.current || !current()) return; setWorking(true); setError(""); try { const result = await readPeopleImportFile(file); if (current()) loadSheets(result, file.name); } catch (cause) { failure(cause); } finally { if (mounted.current) setWorking(false); } };
  const review = async (mappedNames?: PeopleImportRow[], automaticSingle = false) => {
    if (!current() || busyRef.current) return;
    setError(""); setWorking(true);
    try {
      const mapped = mappedNames ?? mapPeopleImportRows(sheets[sheetIndex]!, mapping);
      if (!mapped.length) throw new Error("Choose a sheet containing at least one person.");
      const names = mapped.filter((row) => !row.errors.length).map((row) => ({ row_id: String(row.row), name: row.name }));
      const result = names.length ? await checkPeopleImportNames(schoolId, names) : { results: [] };
      if (!current()) return;
      if (result.results.length !== names.length || names.some((name) => !result.results.some((item) => item.row_id === name.row_id && item.name === name.name))) throw new Error("The name check was incomplete. Try reviewing again.");
      const counts = new Map<string, number>();
      result.results.forEach((item) => counts.set(item.normalized_name, (counts.get(item.normalized_name) ?? 0) + 1));
      const prepared: ReviewRow[] = mapped.map((row) => { const check = result.results.find((item) => item.row_id === String(row.row)); const repeated = check ? (counts.get(check.normalized_name) ?? 0) > 1 : row.repeated; return { ...row, repeated, key: crypto.randomUUID(), check, decision: row.errors.length || repeated || (check?.total ?? 0) > 0 ? null : "create", attempted: false }; });
      replaceRows(prepared);
      setReviewReturn(mappedNames ? "choose" : "map"); setPage(1); setFilter(prepared.some(needsReview) ? "review" : "all");
      if (automaticSingle && prepared.length === 1 && prepared[0]?.decision === "create") { setWorking(false); await save(true); }
      else setStage("review");
    } catch (cause) { failure(cause); } finally { if (mounted.current) setWorking(false); }
  };
  const needsReview = (row: ReviewRow) => !row.decision || Boolean(row.errors.length && row.decision !== "skip");
  const save = async (automaticSingle = false) => {
    if (busyRef.current || !current() || denied || rowRef.current.some(needsReview)) return;
    setWorking(true); setError(""); stop.current = false;
    try {
      for (const row of rowRef.current) {
        if (!current() || stop.current) break;
        if (row.decision === "skip" || row.accepted) continue;
        changeRow(row.row, { attempted: true, saveError: undefined });
        try {
          let person: ReadyCampusPerson;
          if (row.decision === "existing" && row.match) {
            const fresh = await getParticipant(schoolId, row.match.id);
            if (!current()) return;
            if (fresh.id !== row.match.id || fresh.revision !== row.match.revision) throw new Error("This existing person changed. Close this import and review their current profile before choosing them again.");
            person = { id: fresh.id, label: fresh.label ?? `${fresh.first_name} ${fresh.last_name}`.trim(), affiliations: fresh.affiliations ?? [] };
          } else {
            const created = await createParticipant(schoolId, { first_name: row.name, last_name: "", ...(row.affiliation ? { affiliation: row.affiliation } : {}), ...(row.contact_email ? { contact_email: row.contact_email } : {}), ...(row.contact_phone ? { contact_phone: row.contact_phone } : {}), idempotency_key: row.key });
            if (!current()) return;
            person = { id: created.id, label: created.label, affiliations: created.affiliations };
          }
          changeRow(row.row, { accepted: person });
        } catch (cause) { if (!current()) return; changeRow(row.row, { saveError: cause instanceof Error ? cause.message : "Addition not confirmed." }); failure(cause); break; }
      }
      if (current()) {
        const accepted = rowRef.current[0]?.accepted;
        if (automaticSingle && rowRef.current.length === 1 && accepted) onDone([accepted]);
        else setStage("result");
      }
    } finally { if (mounted.current) setWorking(false); }
  };
  const addNames = async () => {
    if (!current() || busyRef.current) return;
    try {
      const parsed = parsePeoplePaste([...names, paste].join("\n"));
      if (parsed.some((row) => row.length > 1)) { loadSheets([{ name: "Pasted spreadsheet", rows: parsed }], "Pasted spreadsheet"); return; }
      const mapped = mapPeopleImportRows({ name: "Names", rows: parsed }, { nameColumn: 0, connectionColumn: null, hasHeader: false }).map((row) => ({ ...row, ...(connection ? { affiliation: connection } : {}) }));
      await review(mapped, mapped.length === 1);
    } catch (cause) { failure(cause); }
  };
  const ready = [...new Map(rows.filter((row) => row.accepted).map((row) => [row.accepted!.id, row.accepted!])).values()];
  const remaining = rows.filter((row) => row.decision !== "skip" && !row.accepted).length;
  const unresolved = rows.filter(needsReview).length;
  const visible = rows.filter((row) => filter === "all" || needsReview(row));
  const pages = Math.max(1, Math.ceil(visible.length / 8));
  const activePage = Math.min(page, pages);
  useLayoutEffect(() => {
    const previousRow = pendingReviewFocus.current;
    if (previousRow === null) return;
    pendingReviewFocus.current = null;
    if (stage !== "review" || filter !== "review") return;
    const remainingRows = Array.from(reviewList.current?.querySelectorAll<HTMLElement>("[data-import-row]") ?? []);
    const next = remainingRows.find((row) => Number(row.dataset.importRow) > previousRow) ?? remainingRows.at(-1);
    const target = next?.querySelector<HTMLInputElement>("input:not(:disabled)") ?? reviewFilters.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? heading.current;
    target?.focus({ preventScroll: true });
  }, [rows, stage, filter, activePage]);
  const sheet = sheets[sheetIndex];
  const columns = sheet ? Math.max(...sheet.rows.map((row) => row.length), 1) : 1;
  const headers = sheet?.rows.find(hasPeopleImportValues);
  const sourceRows = sheet?.rows.map((cells, index) => ({ cells, index })).filter(({ cells }) => hasPeopleImportValues(cells)) ?? [];
  const previewRows = sourceRows.slice(mapping.hasHeader ? 1 : 0, (mapping.hasHeader ? 1 : 0) + 3);
  const mappedColumns = [mapping.nameColumn, mapping.connectionColumn, mapping.emailColumn, mapping.phoneColumn].filter((column): column is number => column !== null && column !== undefined);
  const mappingUnsafe = mappedColumns.some((column) => !Number.isInteger(column) || column < 0 || column >= columns) || new Set(mappedColumns).size !== mappedColumns.length;
  const automaticName = sheet ? guessPeopleImportMapping(sheet).hasHeader : false;
  const sourceCount = Math.max(0, sourceRows.length - Number(mapping.hasHeader));
  const selectedCount = new Set(rows.filter((row) => !needsReview(row) && row.decision !== "skip").map((row) => row.decision === "existing" ? `existing:${row.match?.id}` : `new:${row.key}`)).size;
  const skipped = rows.filter((row) => row.decision === "skip").length;
  const columnOptions = (field: "connectionColumn" | "emailColumn" | "phoneColumn") => Array.from({ length: columns }, (_, index) => index !== mapping.nameColumn && (["connectionColumn", "emailColumn", "phoneColumn"] as const).every((key) => key === field || mapping[key] !== index) ? <option key={index} value={index}>{mapping.hasHeader && typeof headers?.[index] === "string" ? headers[index] : `Column ${index + 1}`}</option> : null);
  const includedFields = [{ label: "Name", column: mapping.nameColumn }, { label: "Connection", column: mapping.connectionColumn }, { label: "Email", column: mapping.emailColumn }, { label: "Phone", column: mapping.phoneColumn }].filter((field): field is { label: string; column: number } => field.column !== null && field.column !== undefined);
  const nameCount = names.filter((name) => name.trim()).length + paste.split(/\r\n|\r|\n/).filter((name) => name.trim()).length;
  const stepLabels = { choose: "One person or a whole list", file: "Choose a file", map: "Match your columns", review: "Review every name", result: "Your additions" };
  const dialogTitle = stage === "file" || stage === "map" ? "Import people" : stage === "review" ? "Review people" : stage === "result" ? "Your additions" : "Add people";
  return <PlannerDialog title={dialogTitle} busy={busy} onClose={close}><div className={`people-bulk people-bulk--${stage}`}>
    <p ref={heading} tabIndex={-1} className="people-bulk__step sr-only">{stepLabels[stage]}</p>
    {busy ? <p role="status">{stage === "file" ? "Reading file…" : stage === "map" ? "Checking names…" : stage === "choose" ? "Working…" : `Adding entries… ${ready.length} confirmed. You can stop after the current entry.`}</p> : null}
    {scope !== initialScope || readOnly ? <p role="alert">This workspace changed or is read-only. Close this sheet and reopen it in an available workspace.</p> : denied ? <><p role="alert">Your access changed. No further additions will be attempted. {ready.length} people were confirmed before access changed.</p><button type="button" className="people-bulk__secondary" onClick={onClose}>Close</button></> : <>
    {stage === "choose" ? <><form id={nameFormId} onSubmit={(event) => { event.preventDefault(); void addNames(); }}><fieldset disabled={busy}><PeopleNamesComposer names={names} draft={paste} onNames={setNames} onDraft={setPaste} disabled={busy} action={<button type="button" className="people-bulk__secondary people-bulk__import" aria-label="Import file" disabled={busy} onClick={() => { setError(""); setStage("file"); }}><FileUp size={18} aria-hidden="true" /><span>Import</span></button>} /><details><summary>{connection ? `Connection: ${connectionLabels[connection]}` : "Add a connection"}</summary><label>Connection to campus<select value={connection} onChange={(event) => setConnection(event.target.value as PeopleImportConnection | "")}><option value="">Not specified</option>{Object.entries(connectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{nameCount > 1 ? <small>Applies to all names.</small> : null}</details></fieldset></form><p>App access stays separate.</p></> : null}
    {stage === "file" ? <>
      <label className="people-bulk__file" data-dialog-focus-region aria-disabled={busy}>
        <FileUp size={28} aria-hidden="true" />
        <span><strong>Choose file</strong><small>Excel, CSV or TSV</small></span>
        <input type="file" aria-label="Choose file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
      </label>
      <div className="people-bulk__template">
        <a href="/templates/people-import-template.xlsx" download="people-import-template.xlsx"><Download size={18} aria-hidden="true" />Download sample template</a>
        <small>10 example rows · Excel</small>
        <p>Replace sample rows before uploading.</p>
      </div>
      <details><InfoSummary>File details</InfoSummary><p>Up to 100 people · 20 columns · 10 sheets · 1 MiB. Legacy .xls and macro-enabled files are not supported. Uses saved cell values; formulas are not recalculated.</p></details>
    </> : null}
    {stage === "map" && sheet ? <fieldset disabled={busy}>
      <div className="people-bulk__map-heading"><div><strong>{sourceCount} {sourceCount === 1 ? "row" : "rows"} to review</strong>{automaticName && !mappingUnsafe ? <small>{mappedColumns.length} {mappedColumns.length === 1 ? "column" : "columns"} matched</small> : null}</div><p className="people-bulk__filename">{filename}</p></div>
      {sheets.length > 1 ? <label>Sheet<select value={sheetIndex} onChange={(event) => { const index = Number(event.target.value); setSheetIndex(index); setMapping(guessPeopleImportMapping(sheets[index]!)); }}>{sheets.map((item, index) => <option key={`${index}:${item.name}`} value={index}>{item.name}</option>)}</select></label> : null}
      {!automaticName || mappingUnsafe ? <p className="people-bulk__warning">Choose the Name column and check whether your file has headings.</p> : null}
      <details key={`${filename}:${sheetIndex}`} className="people-bulk__mapping" open={!automaticName || mappingUnsafe}><summary>Change columns</summary>
      <div className="people-bulk__columns">
        <label>Name column<select value={mapping.nameColumn} onChange={(event) => { const nameColumn = Number(event.target.value); setMapping({ ...mapping, nameColumn, connectionColumn: mapping.connectionColumn === nameColumn ? null : mapping.connectionColumn, emailColumn: mapping.emailColumn === nameColumn ? null : mapping.emailColumn, phoneColumn: mapping.phoneColumn === nameColumn ? null : mapping.phoneColumn }); }}>{Array.from({ length: columns }, (_, index) => <option key={index} value={index}>{mapping.hasHeader && typeof headers?.[index] === "string" ? headers[index] : `Column ${index + 1}`}</option>)}</select></label>
        <label><span>Connection <small>Optional</small></span><select aria-label="Connection to campus column" value={mapping.connectionColumn ?? ""} onChange={(event) => setMapping({ ...mapping, connectionColumn: event.target.value === "" ? null : Number(event.target.value) })}><option value="">None</option>{columnOptions("connectionColumn")}</select></label>
      </div>
      <div className="people-bulk__columns"><label><span>Email <small>Optional</small></span><select aria-label="Email column" value={mapping.emailColumn ?? ""} onChange={(event) => setMapping({ ...mapping, emailColumn: event.target.value === "" ? null : Number(event.target.value) })}><option value="">None</option>{columnOptions("emailColumn")}</select></label><label><span>Phone <small>Optional</small></span><select aria-label="Phone column" value={mapping.phoneColumn ?? ""} onChange={(event) => setMapping({ ...mapping, phoneColumn: event.target.value === "" ? null : Number(event.target.value) })}><option value="">None</option>{columnOptions("phoneColumn")}</select></label></div>
      <label className="people-bulk__check"><input type="checkbox" aria-label="First populated row contains column headings" checked={mapping.hasHeader} onChange={(event) => setMapping({ ...mapping, hasHeader: event.target.checked })} />Use column headings</label>
      </details>
      <div className="people-bulk__sample" role="region" aria-label="Source preview">{previewRows.map(({ cells, index }) => { const name = peopleImportCellText(cells[mapping.nameColumn]); const affiliation = mapping.connectionColumn === null ? "" : peopleImportCellText(cells[mapping.connectionColumn]); return <div className="people-bulk__preview-row" key={index}><span className="people-bulk__avatar" aria-hidden="true">{initials(name) || <UserRound size={18} />}</span><div><strong>{name || "Blank name"}</strong><small>Row {index + 1}{affiliation ? ` · ${connectionLabels[affiliation.trim().toLowerCase()] ?? affiliation}` : ""}</small></div></div>; })}</div>
      <details className="people-bulk__contacts"><InfoSummary>Included information<span className="people-bulk__preview-count"> · {previewRows.length} of {sourceCount} shown</span></InfoSummary>{previewRows.map(({ cells, index }) => <div className="people-bulk__included" key={index}><strong>Row {index + 1}</strong><dl>{includedFields.map(({ label, column }) => <div key={label}><dt>{label}</dt><dd>{peopleImportCellText(cells[column]) || "Not provided"}</dd></div>)}</dl></div>)}<p>Preview only. All names are checked in the next step. The heading row is excluded when selected. Connections grant no access or responsibilities; optional details apply only to new people.</p></details>
    </fieldset> : null}
    {stage === "review" ? <>
      <p className="people-bulk__summary"><strong>{selectedCount} ready</strong>{unresolved ? <span> · {unresolved} to check</span> : null}{skipped ? <span> · {skipped} skipped</span> : null}</p>
      {rows.length > 8 || rows.some((row) => row.repeated || row.check?.total || row.errors.length) ? <div ref={reviewFilters} className="people-bulk__filters" role="group" aria-label="Import entries"><button type="button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setPage(1); }}>All {rows.length}</button><button type="button" aria-pressed={filter === "review"} onClick={() => { setFilter("review"); setPage(1); }}>Needs review {unresolved}</button></div> : null}
      {filter === "review" && !visible.length ? <p role="status">No names need a choice. View All to check your selections.</p> : null}
      <fieldset ref={reviewList} disabled={busy}>{visible.slice((activePage - 1) * 8, activePage * 8).map((row) => {
        const simple = !row.errors.length && !row.repeated && !row.check?.total;
        return <section key={row.row} data-import-row={row.row} className={`people-bulk__entry${simple ? " people-bulk__entry--simple" : ""}`} aria-label={`Source row ${row.row}`}>
          {simple ? <label className="people-bulk__person"><span className="people-bulk__avatar" aria-hidden="true">{initials(row.name)}</span><span><strong>{row.name}</strong><small>Row {row.row}{row.affiliation ? ` · ${connectionLabels[row.affiliation]}` : ""}</small></span><input type="checkbox" aria-label={`Include ${row.name}`} checked={row.decision === "create"} onChange={(event) => changeRow(row.row, { decision: event.target.checked ? "create" : "skip" })} /></label> : <>
            <header><span className="people-bulk__avatar" aria-hidden="true">{initials(row.name) || <UserRound size={20} />}</span><div><strong>{row.name || "Blank name"}</strong><small>Row {row.row}{row.affiliation ? ` · ${connectionLabels[row.affiliation]}` : ""}</small></div></header>
            {row.errors.map((issue) => <p className="people-bulk__warning" key={issue}>{issue}</p>)}
            {row.check?.total ? <p>Same name found.</p> : row.repeated ? <p>Repeated in this list.</p> : null}
            {row.check?.truncated ? <p className="people-bulk__warning">Showing 5 of {row.check.total} matches. Check People if the right person is not shown; do not guess.</p> : null}
            <div className="people-bulk__choice-list">
            {!row.errors.length ? <>{row.check?.matches.map((match) => <div key={match.id} className="people-bulk__match"><label className="people-bulk__check people-bulk__choice"><input type="radio" aria-label={`Use existing: ${match.label}${(row.check?.matches.length ?? 0) > 1 ? ` · record ${match.id}` : ""}`} name={`decision-${row.row}`} checked={row.decision === "existing" && row.match?.id === match.id} onChange={() => changeRow(row.row, { decision: "existing", match })} /><span><strong>Use existing: {match.label}</strong><small>{match.affiliations.map((value) => connectionLabels[value] ?? value).join(" · ") || "Campus person"}{(row.check?.matches.length ?? 0) > 1 ? ` · Ref ${match.id.slice(0, 8)}` : ""}</small></span></label><details className="people-bulk__record"><InfoSummary>Profile details<span className="sr-only"> for record {match.id}</span></InfoSummary><a href={`/areas/people/participants/${encodeURIComponent(match.id)}`} target="_blank" rel="noopener noreferrer">View profile<span className="sr-only"> for record {match.id} (opens in a new tab)</span></a><small>Record {match.id}</small></details></div>)}{row.check?.matches.length && (row.affiliation || row.contact_email || row.contact_phone) ? <small>Existing details kept.</small> : null}<label className="people-bulk__check people-bulk__choice"><input type="radio" aria-label="Add separate person with this name" name={`decision-${row.row}`} checked={row.decision === "create"} onChange={() => changeRow(row.row, { decision: "create", match: undefined })} />Add separate person</label></> : null}
            <label className="people-bulk__check people-bulk__choice"><input type="radio" aria-label="Skip this entry" name={`decision-${row.row}`} checked={row.decision === "skip"} onChange={() => changeRow(row.row, { decision: "skip", match: undefined })} />Skip</label>
            </div>
          </>}
        </section>;
      })}</fieldset>
      {pages > 1 ? <nav className="people-bulk__pagination" aria-label="Import review pages"><button type="button" disabled={busy || activePage === 1} onClick={() => setPage(activePage - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</button><span>{activePage} of {pages}</span><button type="button" disabled={busy || activePage === pages} onClick={() => setPage(activePage + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button></nav> : null}
      {visible.slice((activePage - 1) * 8, activePage * 8).some((row) => row.affiliation || row.contact_email || row.contact_phone) ? <details className="people-bulk__contacts"><InfoSummary>Included information</InfoSummary>{visible.slice((activePage - 1) * 8, activePage * 8).filter((row) => row.affiliation || row.contact_email || row.contact_phone).map((row) => <div className="people-bulk__included" key={row.row}><strong>{row.name} · Row {row.row}</strong><dl>{row.affiliation ? <div><dt>Connection</dt><dd>{connectionLabels[row.affiliation]}</dd></div> : null}{row.contact_email ? <div><dt>Email</dt><dd>{row.contact_email}</dd></div> : null}{row.contact_phone ? <div><dt>Phone</dt><dd>{row.contact_phone}</dd></div> : null}</dl></div>)}<small>Selected page only. Optional details apply only to new people. Existing details stay unchanged.</small></details> : null}
      <details><InfoSummary>What gets added?</InfoSummary><p>No accounts, enrollment, groups or attendance marks will be created. Matching names never prove identity; existing people are reused only when you choose their exact record.</p></details>
    </> : null}
    {stage === "result" ? <>
      <div className="people-bulk__receipt" role="status"><ProductIcon name="people" size={32} /><div><strong>{ready.length} {ready.length === 1 ? "person" : "people"} ready</strong>{skipped || remaining ? <p>{[skipped ? `${skipped} skipped` : "", remaining ? `${remaining} not confirmed` : ""].filter(Boolean).join(" · ")}</p> : null}</div></div>
      {rows.filter((row) => row.saveError).map((row) => <p key={row.row}>Row {row.row}: {row.saveError}</p>)}
      {remaining ? <p>Confirmed people stay saved. Retry keeps each entry's original key and never adds confirmed people again. Unconfirmed requests may already have succeeded.</p> : null}
    </> : null}
    {error ? <p role="alert" className="people-bulk__warning">{error}</p> : null}
    <footer>{stage === "choose" ? <><button type="button" className="people-bulk__secondary" onClick={close} disabled={busy}>Cancel</button><button type="submit" form={nameFormId} disabled={busy || !nameCount}>{busy ? "Working…" : nameCount > 1 ? `Review ${nameCount} people` : "Add person"}</button></> : stage === "result" ? <><button type="button" className="people-bulk__secondary" onClick={close} disabled={busy}>Close</button>{remaining ? <button type="button" disabled={busy} onClick={() => void save()}>Retry remaining</button> : null}<button type="button" disabled={busy || !ready.length} onClick={() => { if (current()) onDone(ready); }}>Use {ready.length} ready {ready.length === 1 ? "person" : "people"}</button></> : <><button type="button" className="people-bulk__secondary" disabled={busy} onClick={() => { setError(""); if (stage === "review") { setStage(reviewReturn); replaceRows([]); } else setStage("choose"); }}>Back</button>{stage === "map" ? <button type="button" disabled={busy || mappingUnsafe} onClick={() => void review()}>{busy ? "Checking names…" : "Review names"}</button> : stage === "review" ? busy ? <button type="button" onClick={() => { stop.current = true; }}>Stop after current entry</button> : <>{unresolved ? <span className="people-bulk__pending" role="status">{unresolved} {unresolved === 1 ? "choice" : "choices"} left</span> : null}<button type="button" disabled={unresolved > 0 || !selectedCount} onClick={() => void save()}>Confirm</button></> : null}</>}</footer>
    </>}
  </div></PlannerDialog>;
}
