import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Backpack,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Send,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { schoolDateToday, shiftSchoolDate } from "../../lib/schoolTime";
import { ProductIcon } from "../../components/ProductIcon";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { useOptionalAuth } from "../auth/AuthContext";
import { ClassPracticeView } from "./ClassPracticeView";
import {
  acknowledgeDiary,
  addDiaryNote,
  getParentDiary,
  getStudentDiary,
  getDiaryItem,
  setHomeworkCompleted,
  type ApiDiaryItem,
  type ParentDiaryResponse,
  type StudentDiaryResponse,
} from "../school/api";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import type { WorkspaceArea, WorkspaceAreaSurface } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import "./diary-workspace.css";

type DiaryScope = "self" | "dependent";

interface LearnerDiaryContext {
  readonly key: string;
  readonly scope: DiaryScope;
  readonly studentId: string;
  readonly label: string;
  readonly description?: string | null;
}
type DiaryContext = LearnerDiaryContext | { readonly key:string; readonly scope:"class"; readonly classId:string; readonly label:string; readonly description?:string|null };

function diaryRelationship(surface: WorkspaceAreaSurface) {
  const match = surface.key.match(/^diary:(self|dependent|class):(.+)$/);
  return match ? match[1] === "class" ? { scope:"class" as const,classId:match[2]! } : { scope: match[1] as DiaryScope, studentId: match[2]! } : null;
}

export function diaryContextOptions(area: WorkspaceArea): DiaryContext[] {
  return area.surfaces.flatMap((surface) => {
    const relationship = diaryRelationship(surface);
    return relationship ? [{ key: surface.key, ...relationship, label: surface.label, description: surface.description }] : [];
  });
}

function requestedDiaryKey(params: URLSearchParams) {
  const scope = params.get("scope");
  const studentId = params.get("student_id");
  const classId = params.get("class_section_id");
  if(scope === "class" && classId && !studentId)return `diary:class:${classId}`;
  if ((scope === "self" || scope === "dependent") && studentId) return `diary:${scope}:${studentId}`;
  return scope || studentId || classId ? null : undefined;
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

function dateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

function clock(value: string | null | undefined) {
  if (!value) return "";
  const date = value.includes("T") ? new Date(value) : new Date(`2000-01-01T${value}`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(date);
}

function kindIcon(item: ApiDiaryItem) {
  if (item.item_type === "homework") return <ProductIcon name="learning" size={28} />;
  if (item.item_type === "announcement") return <ProductIcon name="updates" size={28} />;
  if (item.item_type === "schedule") return <ProductIcon name="schedule" size={28} />;
  return <ProductIcon name="messages" size={28} />;
}

type DiaryFilter = "all" | ApiDiaryItem["item_type"] | "attention" | "catchup";
const diaryFilters: Array<{ key: DiaryFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs action" },
  { key: "homework", label: "Homework" },
  { key: "note", label: "Notes" },
  { key: "announcement", label: "Announcements" },
  { key: "catchup", label: "Catch-up" },
];

function isCatchUp(item: ApiDiaryItem) {
  return /\b(absent|missed|catch\s*up|catch-up|recap|covered|while away)\b/i.test(`${item.title} ${item.body}`);
}

function needsDiaryAction(item: ApiDiaryItem) {
  return (item.requires_acknowledgement && !item.acknowledged)
    || (item.item_type === "homework" && item.completed === false);
}

function diaryState(item: ApiDiaryItem) {
  if (item.item_type === "homework") {
    if (item.completed === true) return { label: "Done", complete: true };
    if (item.completed === false) return { label: "To do", complete: false };
    return { label: "Status unavailable", complete: false };
  }
  return { label: item.acknowledged ? "Acknowledged" : item.requires_acknowledgement ? "Acknowledge" : "Open", complete: item.acknowledged };
}

function DiaryEntries({ items, studentId, focusId, onRefresh }: {
  readonly items: readonly ApiDiaryItem[];
  readonly studentId: string;
  readonly focusId?: string;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const [filter, setFilter] = useState<DiaryFilter>(focusId ? "attention" : "all");
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const environment = useExecutionEnvironment();
  const readOnly = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "completed" || environment.runStatus === "stopped");
  const active = useRef(true);
  const inFlight = useRef(false);
  const completionCommand = useRef<{key:string;command_id:string}|null>(null);
  const noteCommand = useRef<{key:string;command_id:string;note_id:string}|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const guard = useUnsavedChangesGuard(Boolean(note.trim()) || busy, "Discard this unsent private note? Notes already accepted remain in the conversation.");
  const select = (id:string|null) => {
    if(inFlight.current || !guard())return;
    setSelectedId(id);setNote("");setError("");
  };
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const visible = useMemo(() => items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "attention") return needsDiaryAction(item);
    if (filter === "catchup") return isCatchUp(item);
    return item.item_type === filter;
  }), [filter, items]);

  const acknowledge = async () => {
    if (!selected || selected.acknowledged || !selected.requires_acknowledgement || readOnly || inFlight.current) return;
    inFlight.current=true;
    setBusy(true); setError("");
    try {
      await acknowledgeDiary(selected.id, studentId);
      if(!active.current)return;
      await onRefresh();
    } catch (reason) {
      if(active.current)setError(reason instanceof Error ? reason.message : "This update could not be acknowledged.");
    } finally { inFlight.current=false;if(active.current)setBusy(false); }
  };

  const updateHomework = async () => {
    if (!selected || selected.item_type !== "homework" || typeof selected.completed !== "boolean" || inFlight.current || readOnly) return;
    inFlight.current=true;
    setBusy(true); setError("");
    try {
      const key=`${selected.id}:${!selected.completed}`;
      if(completionCommand.current?.key!==key)completionCommand.current={key,command_id:crypto.randomUUID()};
      await setHomeworkCompleted(selected.id, studentId, !selected.completed, {command_id:completionCommand.current.command_id});
      if(!active.current)return;
      await onRefresh();
      completionCommand.current=null;
    } catch (reason) {
      if(active.current)setError(reason instanceof Error ? reason.message : "Homework status could not be saved.");
    } finally { inFlight.current=false;if(active.current)setBusy(false); }
  };

  const sendNote = async () => {
    if (!selected || note.trim().length < 2 || readOnly || inFlight.current) return;
    inFlight.current=true;
    setBusy(true); setError("");
    try {
      if(selected.item_type==="homework"){
        const key=`${selected.id}:${note.trim()}`;
        if(noteCommand.current?.key!==key)noteCommand.current={key,command_id:crypto.randomUUID(),note_id:crypto.randomUUID()};
        await addDiaryNote(selected.id,studentId,note.trim(),{command_id:noteCommand.current.command_id,note_id:noteCommand.current.note_id});
      }else await addDiaryNote(selected.id, studentId, note.trim());
      if(!active.current)return;
      await onRefresh();
      noteCommand.current=null;
      setNote("");
      setSelectedId(null);
    } catch (reason) {
      if(active.current)setError(reason instanceof Error ? reason.message : "Your note could not be sent.");
    } finally { inFlight.current=false;if(active.current)setBusy(false); }
  };

  return <>
    {readOnly?<p role="status">This simulation is read-only.</p>:null}
    <div className="diary-workspace__filters" role="group" aria-label="Filter diary updates">
      {diaryFilters.map((item) => <button key={item.key} type="button" disabled={busy} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}{item.key === "attention" ? ` ${items.filter(needsDiaryAction).length}` : ""}</button>)}
    </div>
    <section className="diary-workspace__entries" aria-labelledby="diary-entries-heading">
      <header><div><small>Published record</small><h2 id="diary-entries-heading">Diary updates</h2></div><strong>{visible.length}</strong></header>
      {visible.length ? visible.map((item) => <button className="diary-entry" type="button" disabled={busy} key={item.id} onClick={() => select(item.id)} aria-label={`Open ${item.title}`}>
        <span className={`diary-entry__icon is-${item.item_type}`}>{kindIcon(item)}</span>
        <span className="diary-entry__copy"><small>{item.subject?.short_name ?? item.item_type_label} · {shortDate(item.date)}</small><strong>{item.title}</strong><span>{item.body}</span><em>{item.author_name}{item.due_at ? ` · Due ${dateTime(item.due_at)}` : ""}</em></span>
        <span className="diary-entry__states"><span className={`diary-entry__state${diaryState(item).complete ? " is-complete" : needsDiaryAction(item) ? " is-action" : ""}`}>{diaryState(item).complete ? <CheckCircle2 size={14} /> : null}{diaryState(item).label}</span>{item.item_type === "homework" && item.requires_acknowledgement ? <span className="diary-entry__acknowledgement">{item.acknowledged ? "Acknowledged" : "Acknowledge"}</span> : null}</span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>) : <div className="diary-workspace__empty" role="status"><ProductIcon name="updates" size={40} /><div><strong>No diary updates here</strong><span>Try another filter or check again after something is published.</span></div></div>}
    </section>
    {selected ? <div className="diary-sheet-backdrop" role="presentation" onClick={() => select(null)}>
      <section className="diary-sheet" role="dialog" aria-modal="true" aria-labelledby="diary-sheet-title" aria-busy={busy} onClick={(event) => event.stopPropagation()}>
        <div className="diary-sheet__handle" />
        <header><span className={`diary-entry__icon is-${selected.item_type}`}>{kindIcon(selected)}</span><div><p>{selected.subject?.name ?? selected.item_type_label}</p><h2 id="diary-sheet-title">{selected.title}</h2></div><button type="button" disabled={busy} aria-label="Close diary update" onClick={() => select(null)}><X size={19} /></button></header>
        <p className="diary-sheet__body">{selected.body}</p>
        <dl><div><dt>Published by</dt><dd>{selected.author_name}</dd></div><div><dt>Published</dt><dd>{dateTime(selected.published_at)}</dd></div>{selected.due_at ? <div><dt>Due</dt><dd>{dateTime(selected.due_at)}</dd></div> : null}</dl>
        {selected.notes.length ? <section className="diary-sheet__history" aria-label="Private note history"><h3>Private notes</h3>{selected.notes.length===100?<p>Latest 100 entries shown.</p>:null}{selected.notes.map((entry) => <article key={entry.id}><strong>{entry.author_name}</strong><p>{entry.body}</p><time dateTime={entry.created_at}>{dateTime(entry.created_at)}</time></article>)}</section> : null}
        <p className="class-practice-caption">Private to this learner, current guardians and the authorized source author.</p>
        <label className="diary-sheet__note"><span>Add a private note or question</span><textarea disabled={busy||readOnly} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="Write a short note" /></label>
        <button className="diary-sheet__secondary" type="button" disabled={busy || readOnly || note.trim().length < 2} onClick={() => void sendNote()}><Send size={16} />Send note</button>
        {selected.requires_acknowledgement ? <button className={selected.item_type === "homework" ? "diary-sheet__secondary" : "diary-sheet__primary"} type="button" disabled={busy || readOnly || selected.acknowledged} onClick={() => void acknowledge()}><Check size={17} />{selected.acknowledged ? "Acknowledged" : "Acknowledge update"}</button> : null}
        {selected.item_type === "homework" ? <><p className="diary-sheet__completion" role="status">{selected.completed === true ? `Done${selected.completed_at ? ` · ${dateTime(selected.completed_at)}` : ""}` : selected.completed === false ? "Not done yet" : "Homework status unavailable. Try reloading this update."}</p><button className={selected.completed === true ? "diary-sheet__secondary" : "diary-sheet__primary"} type="button" disabled={busy || readOnly || typeof selected.completed !== "boolean"} onClick={() => void updateHomework()}><Check size={17} />{selected.completed === true ? "Mark as not done" : "Mark homework done"}</button></> : null}
        {error ? <p className="diary-sheet__error" role="alert">{error}</p> : null}
      </section>
    </div> : null}
  </>;
}

function dateOptions(selected: string) {
  return [-2, -1, 0, 1, 2].map((offset) => {
    const id = shiftSchoolDate(offset, selected);
    const date = new Date(`${id}T00:00:00`);
    return { id, weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date), day: date.getDate() };
  });
}

function packingItems(items: readonly ApiDiaryItem[]) {
  return items.filter((item) => /\b(?:bring|pack|notebook|sheet|kit|uniform|material)\b/i.test(item.body));
}

function storedPackingState(key: string): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

function useDiaryReadKey(schoolId:string,actorId:string){
  return executionEnvironmentQueryKey(useExecutionEnvironment(),["school","workspace","diary",schoolId,actorId]);
}

function ExactLearnerDiary({context,schoolId,actorId,focusId,onReturn}:{context:LearnerDiaryContext;schoolId:string;actorId:string;focusId:string;onReturn:()=>void}){
  const key=useDiaryReadKey(schoolId,actorId),client=useQueryClient();
  const query=useQuery({queryKey:[...key,"exact",context.studentId,focusId],queryFn:()=>getDiaryItem(focusId,context.studentId)});
  if(query.isPending)return <WorkspaceState state="loading"/>;
  if(query.error||!query.data)return <><WorkspaceState state="error" error={query.error} onRetry={query.refetch}/><button type="button" onClick={onReturn}>Return to diary</button></>;
  return <><button type="button" className="activity-text-button" onClick={onReturn}>Return to diary</button><DiaryEntries items={[query.data]} studentId={context.studentId} focusId={focusId} onRefresh={async()=>{await query.refetch();await client.invalidateQueries({queryKey:key});await client.invalidateQueries({queryKey:["responsibility-workspace"]});}}/></>;
}

function DependentDiary({ context, selectedDate, onDateChange, focusId, schoolId, actorId }: { readonly context: LearnerDiaryContext; readonly selectedDate: string; readonly onDateChange: (date: string) => void; readonly focusId?: string;schoolId:string;actorId:string }) {
  const queryClient = useQueryClient();
  const key=useDiaryReadKey(schoolId,actorId);
  const query = useQuery({ queryKey: [...key, "dependent", context.studentId, selectedDate], queryFn: () => getParentDiary(selectedDate, context.studentId) });
  const packedKey = `thatcampus:packing:${JSON.stringify(key)}:${context.studentId}:${selectedDate}`;
  const [packed, setPacked] = useState<Record<string, boolean>>(() => storedPackingState(packedKey));
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (query.isError || !query.data) return <WorkspaceState state="error" error={query.error} onRetry={query.refetch} />;
  const response: ParentDiaryResponse = query.data;
  if (response.student.id !== context.studentId) return <WorkspaceState state="revoked" />;
  const pack = packingItems(response.items);
  const refresh = async () => {
    await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ["school"] })]);
  };
  return <div className="diary-workspace__stack">
    <section className="diary-date-context" aria-label="Diary date">
      <div><small>Selected date</small><strong>{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${selectedDate}T00:00:00`))}</strong></div>
      <div className="diary-date-strip">{dateOptions(selectedDate).map((date) => <button key={date.id} className={date.id === selectedDate ? "is-selected" : ""} type="button" onClick={() => onDateChange(date.id)} aria-pressed={date.id === selectedDate}><span>{date.weekday}</span><strong>{date.day}</strong></button>)}</div>
    </section>
    {(response.schedule.length || pack.length) ? <details className="diary-day-context">
      <summary><CalendarDays size={17} />Day plan & preparation<span>{response.schedule.length} sessions{pack.length ? ` · ${pack.length} to pack` : ""}</span></summary>
      {response.schedule.length ? <div className="diary-day-context__schedule">{response.schedule.map((slot) => <article key={slot.id}><time>{clock(slot.starts_at)}</time><span><strong>{slot.display_title}</strong><small>{slot.teacher?.name ?? "Class team"}{slot.room ? ` · ${slot.room}` : ""}</small></span></article>)}</div> : null}
      {pack.length ? <div className="diary-day-context__packing"><h3><Backpack size={17} />Preparation list <small>Saved on this device</small></h3>{pack.map((item) => <label key={item.id} className={packed[item.id] ? "is-packed" : ""}><input type="checkbox" checked={Boolean(packed[item.id])} onChange={(event) => { const next = { ...packed, [item.id]: event.target.checked }; setPacked(next); window.localStorage.setItem(packedKey, JSON.stringify(next)); }} /><span>{item.title}</span></label>)}</div> : null}
    </details> : null}
    <DiaryEntries items={response.items} studentId={context.studentId} focusId={focusId} onRefresh={refresh} />
  </div>;
}

function SelfDiary({ context, focusId, schoolId, actorId }: { readonly context: LearnerDiaryContext; readonly focusId?: string;schoolId:string;actorId:string }) {
  const queryClient = useQueryClient();
  const from = useMemo(() => shiftSchoolDate(-7), []);
  const to = useMemo(() => shiftSchoolDate(7), []);
  const key=useDiaryReadKey(schoolId,actorId);
  const query = useQuery({ queryKey: [...key, "self", context.studentId, from, to], queryFn: () => getStudentDiary(from, to) });
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (query.isError || !query.data) return <WorkspaceState state="error" error={query.error} onRetry={query.refetch} />;
  const response: StudentDiaryResponse = query.data;
  if (response.student.id !== context.studentId) return <WorkspaceState state="revoked" />;
  const refresh = async () => {
    await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ["school"] })]);
  };
  const items = [...response.items].sort((left, right) => {
    const action = Number(needsDiaryAction(right)) - Number(needsDiaryAction(left));
    return action || right.date.localeCompare(left.date) || right.published_at.localeCompare(left.published_at);
  });
  return <div className="diary-workspace__stack"><p className="diary-range"><CalendarDays size={16} />{shortDate(response.date_from)}–{shortDate(response.date_to)}</p><DiaryEntries items={items} studentId={context.studentId} focusId={focusId} onRefresh={refresh} /></div>;
}

export function WorkspaceDiaryRoute() {
  const environment = useExecutionEnvironment();
  const auth=useOptionalAuth();
  const manifest = useWorkspaceManifest();
  const [params, setParams] = useSearchParams();
  if (environment.mode === "simulation" && environment.unavailable === true) return <OperationsShell active="areas" title="Diary" backTo="/areas/messages"><WorkspaceState state="unavailable" /></OperationsShell>;
  if (manifest.isPending) return <OperationsShell active="areas" title="Diary" backTo="/areas/messages"><WorkspaceState state="loading" /></OperationsShell>;
  if (manifest.error) return <OperationsShell active="areas" title="Diary" backTo="/areas/messages"><WorkspaceState state="error" error={manifest.error} onRetry={manifest.refetch} /></OperationsShell>;
  const area = manifest.data?.areas.find((entry) => entry.key === "messages");
  const options = area ? diaryContextOptions(area) : [];
  const requested = requestedDiaryKey(params);
  const malformed = params.has("scope") || params.has("student_id") || params.has("class_section_id");
  const selected = requested ? options.find((option) => option.key === requested) : !malformed ? options[0] : undefined;
  if (!manifest.data || !manifestMatchesEnvironment(manifest.data, environment) || !selected) return <OperationsShell active="areas" title="Diary" backTo="/areas/messages"><WorkspaceState state="revoked" onRetry={manifest.refetch} /></OperationsShell>;
  const changeScope = (key: string) => {
    const option = options.find((candidate) => candidate.key === key);
    if (!option) return;
    const next = new URLSearchParams(params);
    next.set("scope", option.scope);
    next.delete("student_id");next.delete("class_section_id");next.delete("practice");next.delete("learner");next.delete("page");
    if(option.scope==="class")next.set("class_section_id",option.classId);else next.set("student_id", option.studentId);
    next.delete("date");
    next.delete("diary_item");
    setParams(next);
  };
  const changeDate = (date: string) => {
    const next = new URLSearchParams(params); next.set("date", date); next.delete("diary_item"); setParams(next);
  };
  const selectedDate = params.get("date") ?? schoolDateToday();
  const schoolId=manifest.data.context.institution_id,actorId=auth?.user?.id??manifest.data.context.actor_user_id??"session";
  const bodyKey=JSON.stringify([schoolId,actorId,environment.mode,environment.mode==="simulation"?environment.namespaceId:"live",selected.key,params.get("diary_item")]);
  const returnToDiary=()=>{const next=new URLSearchParams(params);next.delete("diary_item");setParams(next,{replace:true});};
  return <OperationsShell active="areas" title="Diary" backTo="/areas/messages">
    <div className="diary-workspace" key={bodyKey}>
      <section className="diary-workspace__scope" aria-label="Diary scope"><span><small>Diary scope</small><strong>{selected.label}</strong>{selected.description ? <span>{selected.description}</span> : null}</span>{options.length > 1 ? <label><span className="sr-only">Choose diary scope</span><select value={selected.key} onChange={(event) => changeScope(event.target.value)}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label> : null}</section>
      {selected.scope === "class"?<ClassPracticeView schoolId={schoolId} actorId={actorId} classId={selected.classId}/>:params.get("diary_item")?<ExactLearnerDiary context={selected} schoolId={schoolId} actorId={actorId} focusId={params.get("diary_item")!} onReturn={returnToDiary}/>:selected.scope === "dependent"
        ? <DependentDiary key={`${selected.key}:${selectedDate}`} context={selected} selectedDate={selectedDate} onDateChange={changeDate} schoolId={schoolId} actorId={actorId} />
        : <SelfDiary context={selected} schoolId={schoolId} actorId={actorId} />}
    </div>
  </OperationsShell>;
}

export default WorkspaceDiaryRoute;
