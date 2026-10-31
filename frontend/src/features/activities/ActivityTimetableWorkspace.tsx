import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Search, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { DateNavigation, DateViewSelect } from '../../components/date-navigation/DateNavigation';
import { shiftDate } from "../calendar/monthGrid";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { useOptionalAuth } from "../auth/AuthContext";
import type { UnsavedChangesNavigationGuard } from "../navigation/useUnsavedChangesGuard";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { applicationNow } from "../simulation/applicationTime";
import { ActivityCalendar, type ActivityTimeSelection } from "./ActivityCalendar";
import { ActivityAgenda } from './ActivityAgenda';
import { ActivityPlanEditor } from "./ActivityPlanEditor";
import { ActivityPlanDetail } from "./ActivityPlanDetail";
import { ActivityOccurrenceDetail } from "./ActivityOccurrenceDetail";
import { ActivityPagination } from "./ActivityPagination";
import { attendanceStartTime } from "./activityStartTime";
import { activityTimetableSelection } from "./activityTimetableSelection";
import { activityDate, activityPage, campusDate, purposeLabels } from "./activityExperience";
import { getActivityCatalogue, getActivityOccurrences, getActivityPlans, type ActivityOccurrence, type ActivityPlan } from "./api";
import "../planner/principal-planner.css";
import { ProductIcon } from "../../components/ProductIcon";
import "./activities.css";
import "./timetable-controls.css";

type TimetableProps = { schoolId: string; context?: ReactNode; planning?: boolean };
export function ActivityTimetableWorkspace(props: TimetableProps) {
  const environment = useExecutionEnvironment();
  const auth = useOptionalAuth();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Timetable"><p role="alert">This simulation is unavailable. Return to its workspace to recover it.</p></OperationsShell>;
  const identity = JSON.stringify([props.schoolId, auth?.user?.id, environment.mode,
    environment.mode === "simulation" ? environment.namespaceId : "live", environment.mode === "simulation" ? environment.runId : "live"]);
  return <ActivityTimetableContext key={identity} {...props} actorId={auth?.user?.id} />;
}

function ActivityTimetableContext({ schoolId, context, planning = true, actorId }: TimetableProps & { actorId?: string }) {
  const environment = useExecutionEnvironment();
  const readOnly = environment.mode === "simulation" && (environment.unavailable === true || environment.runStatus === "completed" || environment.runStatus === "stopped");
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const queryRoot = ["activities", schoolId, "actor", actorId ?? "session"] as const;
  const catalogue = useQuery({ queryKey: executionEnvironmentQueryKey(environment, [...queryRoot, "catalogue"]), queryFn: () => getActivityCatalogue(schoolId) });
  const timezone = catalogue.data?.timezone ?? (environment.mode === "simulation" && !environment.unavailable ? environment.virtualClock.timeZone : "UTC");
  const today = campusDate(applicationNow(), timezone);
  const requestedDate = params.get("date");
  const date = activityDate(requestedDate, today);
  const [defaultView] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 680px)').matches ? 'agenda' : 'day');
  const requestedView = params.get('view');
  const view = requestedView === 'agenda' || requestedView === 'day' ? requestedView : defaultView;
  const section = planning && params.get("section") === "drafts" ? "drafts" : "calendar";
  const page = activityPage(params.get("page"));
  const until = section === 'calendar' && view === 'agenda' ? shiftDate(date, 6) : date;
  const [slot, setSlot] = useState<(ActivityTimeSelection & { intent?: "attendance" | "activity"; sourcePlan?: string }) | null>(null);
  const [selected, setSelected] = useState<ActivityOccurrence | null>(null);
  const selection = activityTimetableSelection(params);
  const selectedPlan = selection.plan;
  const [message, setMessage] = useState("");
  const [savedPlan, setSavedPlan] = useState<ActivityPlan | null>(null);
  const [beforeLeave, setBeforeLeave] = useState<UnsavedChangesNavigationGuard | null>(null);
  const registerBeforeLeave = useCallback((guard: UnsavedChangesNavigationGuard | null) => setBeforeLeave(() => guard), []);
  const search = params.get("search")?.slice(0, 120) ?? "";
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const creation = !readOnly && planning && !selection.invalid && (selection.create || slot?.sourcePlan && slot.sourcePlan === selection.plan) && catalogue.data?.can_manage
    ? slot ?? (selection.create === "attendance" ? { ...attendanceStartTime(applicationNow(), timezone), intent: "attendance" as const }
      : { date, start: "09:00", end: "10:00", intent: "activity" as const }) : null;
  const occurrences = useQuery({ queryKey: executionEnvironmentQueryKey(environment, [...queryRoot, "occurrences", "expected", date, until, page]), queryFn: () => getActivityOccurrences(schoolId, date, until, page), enabled: catalogue.isSuccess && section === "calendar" });
  const plans = useQuery({ queryKey: executionEnvironmentQueryKey(environment, [...queryRoot, "plans", date, date, page]), queryFn: () => getActivityPlans(schoolId, date, date, page), enabled: catalogue.isSuccess && section === "drafts" });
  useEffect(() => { heading.current?.focus(); }, [page, section]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const closeSearch = () => { const next = new URLSearchParams(params); next.delete("search"); setParams(next, { replace: true }); setSearchOpen(false); searchButton.current?.focus(); };
  const setContext = (values: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); if (!("page" in values)) next.delete("page"); setParams(next); };
  const openPlan = (id: string, revision?: number) => { if (!active.current) return; const next = new URLSearchParams(params); next.delete("create"); next.set("plan", id); if (revision) next.set("plan_revision", String(revision)); else next.delete("plan_revision"); setParams(next); };
  const closeSource = () => { const next = new URLSearchParams(params); next.delete("plan"); next.delete("plan_revision"); next.delete("create"); setSlot(null); setSelected(null); setParams(next, { replace: true }); };
  const createActivity = (time: ActivityTimeSelection) => { setSelected(null); setSlot({ ...time, intent: "activity" }); const next = new URLSearchParams(params); next.delete("plan"); next.delete("plan_revision"); next.set("create", "activity"); setParams(next); };
  const saved = async (plan: ActivityPlan, notice: string) => {
    if (!active.current) return;
    client.setQueryData(executionEnvironmentQueryKey(environment, [...queryRoot, "plan", plan.id]), plan);
    setSlot(null); setSelected(null); setMessage(notice);
    setSavedPlan(plan);
    const next = new URLSearchParams(params);
    next.delete("create"); next.delete("page"); next.delete("search"); next.delete("plan"); next.delete("plan_revision"); next.set("date", plan.starts_on); next.set("view", view);
    if (plan.state === "draft") { next.set("section", "drafts"); next.set("plan", plan.id); next.set("plan_revision", String(plan.revision)); } else next.delete("section");
    setParams(next, { replace: true });
    await client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId]) });
    await client.invalidateQueries({ queryKey: ["responsibility-workspace"] });
    await client.invalidateQueries({ queryKey: ["onboarding"] });
  };
  const visible = (occurrences.data?.items ?? []).filter((item) => item.state === "expected" && `${item.title} ${item.space_label ?? ""} ${item.participants.map((person) => person.label).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const publishedOccurrence = savedPlan?.state === "published" ? occurrences.data?.items.find(item => item.plan_version_id === savedPlan.id && item.state === "expected" && item.can_open_register && item.attendance_mode === "roll_call") : undefined;
  const chooseOccurrence = (item: ActivityOccurrence) => { setSelected(item); if (planning && item.source === "activity") openPlan(item.activity_id, item.source_revision); };
  const error = catalogue.error ?? occurrences.error ?? plans.error;
  const optionsPanel = optionsOpen ? <section id="timetable-options" className="activity-timetable-options" aria-label="Timetable options" onKeyDown={(event) => { if (event.key === "Escape") { setOptionsOpen(false); optionsButton.current?.focus(); } }}>
    {context}<p className="activity-caption">Times use {timezone}. Scheduled activities are expectations, not proof of attendance.</p>
  </section> : null;
  return <OperationsShell active="areas" title="Timetable" backTo="/areas/timetable" beforeBack={beforeLeave ?? undefined} pageTitleTrailing={planning && catalogue.data?.can_manage && !readOnly ? <button type="button" className="activity-primary activity-create" aria-label="Schedule activity" onClick={() => createActivity({ date, start: "09:00", end: "10:00" })}><Plus size={18} aria-hidden="true" />Add</button> : undefined}>
    <div className="activity-workspace activity-workspace--timetable">
      {readOnly ? <p className="activity-notice">This simulation has ended. Its saved timetable is read-only.</p> : null}
      {planning && catalogue.data?.can_manage ? <div className="activity-timetable-navigation">
        <nav className="activity-timetable-tabs" aria-label="Timetable views"><button type="button" aria-pressed={section === "calendar"} onClick={() => setContext({ section: "" })}>Schedule</button><button type="button" aria-pressed={section === "drafts"} onClick={() => setContext({ section: "drafts" })}>Plans & drafts</button></nav>
        {section === 'drafts' ? <button ref={optionsButton} type="button" className="activity-timetable-options-toggle" aria-label="Timetable options" aria-expanded={optionsOpen} aria-controls="timetable-options" onClick={() => setOptionsOpen(!optionsOpen)}>Options<ChevronDown size={16} aria-hidden="true" /></button> : null}
      </div> : null}
      {section === 'drafts' ? optionsPanel : null}
      <h2 ref={heading} tabIndex={-1} className="sr-only">{section === "drafts" ? "Plans and drafts" : "Scheduled activities"}</h2>
      {selection.invalid ? <div className="activity-error" role="alert"><p>This activity link is incomplete. No draft has been created.</p><button type="button" onClick={closeSource}>Return to timetable</button></div> : selection.create && catalogue.data && !catalogue.data.can_manage ? <div className="activity-error" role="alert">You no longer have permission to schedule this activity. Your existing timetable is unchanged.</div> : null}
      {message ? <div className="activity-notice" role="status"><p>{message}</p>{publishedOccurrence ? <Link className="activity-text-button" to={`/areas/attendance/registers?${new URLSearchParams({ date: publishedOccurrence.local_date, occurrence_id: publishedOccurrence.id })}`}>Open attendance for {publishedOccurrence.local_date}</Link> : savedPlan?.state === "published" ? <button type="button" className="activity-text-button" onClick={() => openPlan(savedPlan.id, savedPlan.revision)}>View published activity</button> : savedPlan?.state === "draft" ? <button type="button" className="activity-text-button" onClick={() => openPlan(savedPlan.id, savedPlan.revision)}>Continue saved draft</button> : null}<button type="button" aria-label="Dismiss confirmation" onClick={() => { setMessage(""); setSavedPlan(null); }}>×</button></div> : null}
      {catalogue.isPending ? <div className="activity-loading" role="status">Loading your campus timetable…</div> : error ? <div className="activity-error" role="alert"><p>{error.message}</p><button type="button" onClick={() => { void catalogue.refetch(); if (section === "calendar") void occurrences.refetch(); else void plans.refetch(); }}>Try again</button>{page > 1 ? <button type="button" onClick={() => setContext({ page: "" })}>Return to first page</button> : null}</div> : catalogue.data ? section === "calendar" ? <>
        <DateNavigation date={date} view="day" today={today} onDateChange={value => setContext({ date: value })} onToday={() => setContext({ date: today })} toolbarTools={<>
          <div className="activity-timetable-tools"><DateViewSelect value={view} label="Timetable display" options={['agenda', 'day']} onChange={value => setContext({ view: value })} /><div><button ref={optionsButton} type="button" className="activity-timetable-options-toggle" aria-label="Timetable options" aria-expanded={optionsOpen} aria-controls="timetable-options" onClick={() => setOptionsOpen(!optionsOpen)}>Options<ChevronDown size={16} aria-hidden="true" /></button><button ref={searchButton} type="button" className="activity-timetable-search-toggle" aria-label={searchOpen ? "Close search" : "Search activities on this page"} aria-expanded={searchOpen} aria-controls="timetable-search" onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>{searchOpen ? <X size={19} aria-hidden="true" /> : <Search size={19} aria-hidden="true" />}</button></div></div>
          {optionsPanel}
          {searchOpen ? <label id="timetable-search" className="activity-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Find an activity on this page</span><input ref={searchInput} value={search} maxLength={120} onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set("search", event.target.value); else next.delete("search"); setParams(next, { replace: true }); }} onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }} placeholder="Search this page" /></label> : null}
        </>} />
        {occurrences.isPending ? <div className="activity-loading" role="status">Loading scheduled activities…</div> : <>
          {view === 'agenda' ? <p className="activity-caption">{new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`))} – {new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${until}T12:00:00Z`))}{(occurrences.data?.total_pages ?? 1) > 1 ? ` · ${visible.length} shown of ${occurrences.data?.total} · page ${occurrences.data?.page ?? page} of ${occurrences.data?.total_pages}` : ''}</p> : (occurrences.data?.total_pages ?? 1) > 1 ? <p className="activity-caption">Page {occurrences.data?.page ?? page} of {occurrences.data?.total_pages} · {visible.length} shown of {occurrences.data?.total} scheduled activities</p> : null}
          {view === 'day' ? <ActivityCalendar date={date} timezone={timezone} occurrences={visible} canManage={planning && catalogue.data.can_manage && !readOnly} onSelect={chooseOccurrence} onCreate={createActivity} /> : null}
          <ActivityAgenda occurrences={visible} from={date} today={today} timezone={timezone} filtered={Boolean(search)} onSelect={chooseOccurrence} />
          <ActivityPagination page={occurrences.data?.page ?? page} pages={occurrences.data?.total_pages ?? 1} total={occurrences.data?.total ?? 0} label="scheduled activities" singularLabel="scheduled activity" onPage={(next) => setContext({ page: String(next) })} />
        </>}
      </> : <>
        <label className="activity-search">Plans active on<TemporalInput type="date" value={date} onChange={(event) => setContext({ date: event.target.value })} /></label>
        <p className="activity-caption">Drafts are private planning work until published. Existing academic plans keep their source and history.</p>
        {plans.isPending ? <p role="status">Loading plans…</p> : <><div className="activity-agenda">{plans.data?.items.length ? plans.data.items.map((plan) => <button type="button" key={`${plan.source}:${plan.id}`} onClick={() => openPlan(plan.id, plan.revision)}><ProductIcon name="timetable" size={24} /><span><strong>{plan.title}</strong><small>{plan.starts_on} · {purposeLabels[plan.purpose]} · {plan.state}{plan.recurrence === "weekly" ? " · weekly" : ""}</small></span><ChevronRight size={18} /></button>) : <p>No plans yet. Schedule an activity to start a draft.</p>}</div><ActivityPagination page={plans.data?.page ?? page} pages={plans.data?.total_pages ?? 1} total={plans.data?.total ?? 0} label="plans" onPage={(next) => setContext({ page: String(next) })} /></>}
        <Link className="activity-text-button" to="/areas/timetable/planning/settings">Academic dates and schedule settings</Link>
      </> : null}
      {catalogue.data && creation ? <ActivityPlanEditor schoolId={schoolId} catalogue={catalogue.data} date={creation.date} start={creation.start} end={creation.end} endDayOffset={"endDayOffset" in creation ? creation.endDayOffset : undefined} intent={creation.intent} onClose={closeSource} onSaved={saved} onBeforeLeaveChange={registerBeforeLeave} onDraftAccepted={(plan) => { if (!active.current) return; setSlot({ ...creation, sourcePlan: plan.id }); const next = new URLSearchParams(params); next.delete("create"); next.set("plan", plan.id); next.set("plan_revision", String(plan.revision)); setParams(next, { replace: true }); }} /> : null}
      {selected && (!planning || selected.source !== "activity") ? <ActivityOccurrenceDetail occurrence={selected} planning={planning && !readOnly} onClose={() => setSelected(null)} /> : catalogue.data && selectedPlan && !creation ? <ActivityPlanDetail key={selectedPlan} schoolId={schoolId} catalogue={{ ...catalogue.data, can_manage: catalogue.data.can_manage && !readOnly }} occurrence={selected?.activity_id === selectedPlan ? selected : undefined} planId={selectedPlan} expectedRevision={selection.revision} onSelectPlan={openPlan} onBeforeLeaveChange={registerBeforeLeave} onReviewCurrent={(plan) => { if (!active.current) return; client.setQueryData(executionEnvironmentQueryKey(environment, [...queryRoot, "plan", plan.id]), plan); const next = new URLSearchParams(params); next.set("plan_revision", String(plan.revision)); setParams(next, { replace: true }); }} onClose={closeSource} onSaved={saved} /> : null}
    </div>
  </OperationsShell>;
}
