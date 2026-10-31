import { useRef, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Search, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AttendanceDateControl } from "../attendance/AttendanceDateControl";
import type { UnsavedChangesNavigationGuard } from "../navigation/useUnsavedChangesGuard";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { applicationNow } from "../simulation/applicationTime";
import { ActivityRegisterEditor } from "./ActivityRegisterEditor";
import { ActivityPagination } from "./ActivityPagination";
import { activityDate, activityInterval, activityPage, campusDate } from "./activityExperience";
import { getActivityRegister, getActivityRegisterForOccurrence, getActivityRegisters, type ActivityRegister, type ActivityRegisterSummary } from "./api";
import { ProductIcon } from "../../components/ProductIcon";
import { registerCategories, registerCategory, registerGroup, registerKindLabel, registerListParams } from "./attendanceQueue";
import "./activities.css";
import "./attendance-queue.css";

function registerState(item: ActivityRegisterSummary) {
  if (item.occurrence_state === "cancelled") return "Cancelled · history retained";
  if (item.state === "draft" && item.participant_count > 0 && item.recorded_count === item.participant_count) return "Ready to submit";
  return item.state === "locked" ? "Final" : item.state === "submitted"
    ? item.finalization?.state === "automatic_pending" ? "Automatic finalization scheduled"
      : item.finalization?.reason === "overdue" ? "Automatic finalization overdue · review needed" : "Awaiting review"
    : item.recorded_count ? "In progress" : "Not recorded";
}
export function ActivityAttendanceWorkspace({ schoolId, coordinate = false, embedded = false, onBeforeLeaveChange }: { schoolId: string; coordinate?: boolean; embedded?: boolean; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) {
  const environment = useExecutionEnvironment();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const timezone = environment.mode === "simulation" && !environment.unavailable ? environment.virtualClock.timeZone : "UTC";
  const requestedDate = params.has("date") ? activityDate(params.get("date"), campusDate(applicationNow(), timezone)) : undefined;
  const page = activityPage(params.get("page"));
  const search = (params.get("search") ?? "").slice(0, 120);
  const view = registerCategory(params.get("attendance_view"));
  const kind = (params.get("activity_kind") ?? "").slice(0, 60);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showFilters = filtersOpen || Boolean(search || kind);
  const selected = params.get("register_id");
  const requestedOccurrence = params.get("occurrence_id");
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (filtersOpen) searchInput.current?.focus(); }, [filtersOpen]);
  const list = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId, "registers", requestedDate, page, search, view, kind]), queryFn: () => getActivityRegisters(schoolId, requestedDate, page, { search, view, kind }), enabled: !selected && !requestedOccurrence });
  const date = requestedDate ?? list.data?.date ?? campusDate(applicationNow(), timezone);
  const counts = list.data?.counts;
  const detailKey = executionEnvironmentQueryKey(environment, ["activities", schoolId, "register", selected ?? `occurrence:${requestedOccurrence}`]);
  const detail = useQuery({ queryKey: detailKey, queryFn: () => selected ? getActivityRegister(schoolId, selected) : getActivityRegisterForOccurrence(schoolId, requestedOccurrence!), enabled: Boolean(selected || requestedOccurrence) });
  useEffect(() => { heading.current?.focus(); }, [page, selected]);
  const set = (values: Record<string, string>) => setParams(registerListParams(params, values));
  const accepted = async (register: ActivityRegister) => {
    client.setQueryData(detailKey, register);
    await client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId, "registers"]) });
    await client.invalidateQueries({ queryKey: ["responsibility-workspace"] });
    await client.invalidateQueries({ queryKey: ["attention"] });
  };
  const open = (item: ActivityRegisterSummary) => {
    if (item.entry_mode !== "participation" && item.source_kind && item.source_kind !== "activity" && item.source?.href) { void navigate(item.source.href); return; }
    const next = registerListParams(params, { register_id: item.id });
    // Pin the server-resolved campus day before drill-down; midnight or an
    // accelerated clock must not change the date when the operator returns.
    if (!next.has("date")) next.set("date", date);
    setParams(next);
  };
  if (selected || requestedOccurrence) return detail.isPending ? <p role="status">Loading participant register…</p> : detail.isError || !detail.data ? <section className="activity-error" role="alert"><p>{detail.error?.message ?? "This register is unavailable."}</p><button type="button" onClick={() => void detail.refetch()}>Try again</button><button type="button" onClick={() => set({ register_id: "", occurrence_id: "" })}>Back to registers</button></section> : <ActivityRegisterEditor key={detail.data.register.id} schoolId={schoolId} initial={detail.data} onAccepted={accepted} onBack={() => set({ register_id: "", occurrence_id: "" })} showBackButton={!embedded} onBeforeLeaveChange={onBeforeLeaveChange} />;
  return <div className="activity-workspace activity-workspace--attendance">
    <div className="attendance-queue-date">
      <AttendanceDateControl date={date} onChange={(next) => set({ date: next, register_id: "" })} />
      <button type="button" aria-label={showFilters ? "Close register filters" : "Find or filter registers"} aria-expanded={showFilters} aria-controls="attendance-queue-filters" onClick={() => {
        setFiltersOpen(!showFilters);
        if (showFilters) set({ search: "", activity_kind: "" });
      }}>{showFilters ? <X size={20} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}</button>
    </div>
    <h2 className="sr-only" ref={heading} tabIndex={-1}>Participant registers</h2>
    {showFilters ? <div className="attendance-queue-tools" id="attendance-queue-filters"><form className="attendance-queue-search" key={search} onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get("search"); set({ search: typeof value === "string" ? value.trim() : "" }); }}>
      <input ref={searchInput} name="search" type="search" aria-label="Search all registers on this date" placeholder="Find an activity or place" defaultValue={search} maxLength={120} />
      <button type="submit" aria-label="Search registers"><Search size={20} aria-hidden="true" /></button>
    </form>
    {((list.data?.available_kinds?.length ?? 0) > 1 || kind) ? <label className="attendance-queue-type">Activity type<select aria-label="Activity type" value={kind} onChange={event => set({ activity_kind: event.target.value })}><option value="">All activities</option>{list.data?.available_kinds?.map(item => <option key={item.kind} value={item.kind}>{registerKindLabel(item.kind)} · {item.count}</option>)}{kind && !list.data?.available_kinds?.some(item => item.kind === kind) ? <option value={kind}>{registerKindLabel(kind)}</option> : null}</select></label> : null}
    </div> : null}
    {(counts && (counts.all > 8 || view !== "all" || registerCategories.filter(item => (counts[item.value] ?? 0) > 0).length > 1)) ? <div className="attendance-queue-views" role="group" aria-label="Register views">
      {[{ value: "all" as const, label: "All" }, ...registerCategories.filter(item => (counts[item.value] ?? 0) > 0 || view === item.value)].map(item => <button type="button" key={item.value} aria-pressed={view === item.value} onClick={() => set({ attendance_view: item.value === "all" ? "" : item.value })}>{item.label}<span>{counts[item.value] ?? 0}</span></button>)}
    </div> : null}
    {list.data ? <p className="attendance-queue-summary">{list.data.total} {search || kind || view !== "all" ? "matching " : ""}{list.data.total === 1 ? "register" : "registers"}{list.data.counts && view === "all" ? ` · ${list.data.counts.needs_recording} to record${list.data.counts.awaiting_review ? ` · ${list.data.counts.awaiting_review} awaiting review` : ""}` : ""}{search || kind || view !== "all" ? <button type="button" onClick={() => set({ search: "", attendance_view: "", activity_kind: "" })}>Clear filters</button> : null}</p> : null}
    {coordinate ? <Link className="activity-text-button" to={`/areas/attendance/coordination?${new URLSearchParams({ date, source: "continuity" })}`}>Paper & offline entries to review</Link> : null}
    {list.isPending ? <div className="activity-loading" role="status">Loading registers…</div> : list.isError ? <div className="activity-error" role="alert"><p>{list.error.message}</p><button type="button" onClick={() => void list.refetch()}>Try again</button>{page > 1 ? <button type="button" onClick={() => set({ page: "" })}>Return to first page</button> : null}</div> : <>
      <div className="attendance-queue-groups" aria-label="Participant registers">{list.data?.registers.length ? registerCategories.map(group => {
        const items = list.data.registers.filter(item => registerGroup(item, applicationNow()) === group.value);
        return items.length ? <section className="attendance-queue-group" key={group.value} aria-label={group.label}><h3>{group.label}</h3><div className="activity-agenda">{items.map(item => <button type="button" key={`${item.source_kind}:${item.id}`} onClick={() => open(item)}><ProductIcon name="attendance" size={24} /><span><strong>{item.title}</strong><small>{item.source_kind === "daily_class" ? "Daily register" : activityInterval(item.starts_at, item.ends_at, item.time_zone)}{item.place_label ? ` · ${item.place_label}` : ""}</small><small>{item.recorded_count} of {item.participant_count} recorded · {registerState(item)}{!item.can_record && item.state === "draft" ? " · Read only" : ""}</small>{item.availability_reason ? <small>{item.availability_reason}</small> : null}</span><ChevronRight size={18} aria-hidden="true" /></button>)}</div></section> : null;
      }) : <section className="activity-empty"><ProductIcon name="attendance" size={40} /><h3>{search || kind || view !== "all" ? "No matching registers" : "No registers on this date"}</h3><p>{search || kind || view !== "all" ? "Try another search or clear the filters to see all available registers." : "Scheduled activities that need attendance appear here within your responsibility."}</p>{search || kind || view !== "all" ? <button type="button" onClick={() => set({ search: "", attendance_view: "", activity_kind: "" })}>Show all registers</button> : <Link to="/areas/timetable/planning">Open timetable</Link>}</section>}</div>
      {(list.data?.total_pages ?? 1) > 1 ? <ActivityPagination page={list.data?.page ?? page} pages={list.data?.total_pages ?? 1} total={list.data?.total ?? 0} label="registers" onPage={(next) => set({ page: String(next) })} /> : null}
    </>}
  </div>;
}
