import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  MessageSquareText,
  NotebookPen,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { StudentShell } from "./StudentShell";
import "./student-pages.css";

export type StudentDiaryKind = "homework" | "note" | "announcement" | "schedule";
export type StudentDiaryFilter = "all" | "homework" | "note" | "announcement" | "catchup";

export interface StudentDiaryItem {
  id: string;
  date: string;
  kind: StudentDiaryKind;
  kindLabel: string;
  subject: string;
  subjectShort: string;
  title: string;
  body: string;
  author: string;
  dueLabel?: string;
  publishedLabel: string;
  requiresAcknowledgement: boolean;
  acknowledged: boolean;
  isCatchUp: boolean;
  notes: Array<{ id: string; author: string; body: string; createdLabel: string }>;
}

export interface StudentDiaryData {
  studentName: string;
  avatarUrl?: string;
  className: string;
  rollNumber: string;
  studentId: string;
  termLabel: string;
  rangeLabel: string;
  items: StudentDiaryItem[];
}

export interface StudentDiaryPageProps {
  data: StudentDiaryData;
  onAcknowledge?: (itemId: string) => Promise<void>;
  onAddNote?: (itemId: string, body: string) => Promise<void>;
}

const filters: Array<{ id: StudentDiaryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "homework", label: "Homework" },
  { id: "note", label: "Remarks" },
  { id: "announcement", label: "Notices" },
  { id: "catchup", label: "Catch-up" },
];

function iconForKind(kind: StudentDiaryKind, isCatchUp: boolean) {
  if (isCatchUp) return <Sparkles size={18} />;
  if (kind === "homework") return <NotebookPen size={18} />;
  if (kind === "announcement") return <Bell size={18} />;
  if (kind === "schedule") return <Clock3 size={18} />;
  return <MessageSquareText size={18} />;
}

function compactName(name: string) {
  return name.split(" ")[0] ?? name;
}

export function StudentDiaryPage({ data, onAcknowledge, onAddNote }: StudentDiaryPageProps) {
  const [filter, setFilter] = useState<StudentDiaryFilter>("all");
  const [selected, setSelected] = useState<StudentDiaryItem | null>(null);
  const [note, setNote] = useState("");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const stats = useMemo(() => {
    const homework = data.items.filter((item) => item.kind === "homework");
    const pending = data.items.filter((item) => item.requiresAcknowledgement && !item.acknowledged);
    return {
      total: data.items.length,
      homework: homework.length,
      pending: pending.length,
      notices: data.items.filter((item) => item.kind === "announcement").length,
      catchup: data.items.filter((item) => item.isCatchUp).length,
    };
  }, [data.items]);

  const filtered = useMemo(() => {
    if (filter === "all") return data.items;
    if (filter === "catchup") return data.items.filter((item) => item.isCatchUp);
    return data.items.filter((item) => item.kind === filter);
  }, [data.items, filter]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function acknowledge(item: StudentDiaryItem) {
    if (!onAcknowledge || !item.requiresAcknowledgement || item.acknowledged) return;
    setBusyItemId(item.id);
    setError("");
    try {
      await onAcknowledge(item.id);
      setToast(`${item.kind === "homework" ? "Marked done" : "Acknowledged"} successfully.`);
      setSelected(null);
    } catch {
      setError("Could not update this diary item. Please try again.");
    } finally {
      setBusyItemId(null);
    }
  }

  async function submitNote() {
    if (!selected || !onAddNote || note.trim().length < 2) return;
    setBusyItemId(selected.id);
    setError("");
    try {
      await onAddNote(selected.id, note.trim());
      setNote("");
      setToast("Your note was added to the diary item.");
      setSelected(null);
    } catch {
      setError("Could not add your note. Please try again.");
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <StudentShell activeNav="diary" section="Diary" className={data.className}>
      <div className="student-page-stack student-diary-page">
        <section className="student-diary-hero" aria-labelledby="student-diary-heading">
          <div className="student-diary-hero__top">
            <div>
              <span>Student diary</span>
              <h1 id="student-diary-heading">Today's work desk</h1>
              <p>{data.rangeLabel} - {data.termLabel}</p>
            </div>
            <span className="student-diary-avatar">
              {data.avatarUrl ? <img src={data.avatarUrl} alt="" /> : compactName(data.studentName).slice(0, 2)}
            </span>
          </div>
          <div className="student-diary-id">
            <span><small>Student</small><strong>{data.studentName}</strong></span>
            <span><small>Class</small><strong>{data.className}</strong></span>
            <span><small>Roll</small><strong>{data.rollNumber}</strong></span>
          </div>
          <div className="student-diary-stats" aria-label="Diary summary">
            <span><strong>{stats.homework}</strong><small>Homework</small></span>
            <span><strong>{stats.pending}</strong><small>Pending</small></span>
            <span><strong>{stats.notices}</strong><small>Notices</small></span>
            <span><strong>{stats.catchup}</strong><small>Catch-up</small></span>
          </div>
        </section>

        <section className="student-card student-diary-summary" aria-labelledby="student-diary-summary-heading">
          <span><ClipboardList size={21} /></span>
          <div>
            <h2 id="student-diary-summary-heading">
              {stats.pending > 0 ? `${stats.pending} action${stats.pending === 1 ? "" : "s"} waiting` : "All caught up"}
            </h2>
            <p>{stats.pending > 0 ? "Finish the required homework or acknowledgements first." : "No required diary action is pending right now."}</p>
          </div>
          <strong>{stats.total} items</strong>
        </section>

        <div className="student-diary-filter" role="tablist" aria-label="Diary filter">
          {filters.map((item) => (
            <button key={item.id} type="button" className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)} aria-selected={filter === item.id}>
              {item.label}
            </button>
          ))}
        </div>

        <section className="student-diary-list" aria-labelledby="student-diary-list-heading">
          <header>
            <div><span>Class desk</span><h2 id="student-diary-list-heading">Diary entries</h2></div>
            <strong>{filtered.length}</strong>
          </header>
          {filtered.length ? filtered.map((item) => (
            <article className={`student-diary-entry tone-${item.kind}${item.isCatchUp ? " is-catchup" : ""}`} key={item.id}>
              <button type="button" onClick={() => setSelected(item)} aria-label={`Open ${item.title}`}>
                <span className="student-diary-entry__icon">{iconForKind(item.kind, item.isCatchUp)}</span>
                <span className="student-diary-entry__copy">
                  <small>{item.subjectShort} - {item.kindLabel}{item.dueLabel ? ` - ${item.dueLabel}` : ""}</small>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <em>{item.author} - {item.publishedLabel}</em>
                </span>
                <span className={item.acknowledged ? "student-diary-status is-done" : item.requiresAcknowledgement ? "student-diary-status is-pending" : "student-diary-status"}>
                  {item.acknowledged ? <CheckCircle2 size={14} /> : null}
                  {item.acknowledged ? "Done" : item.requiresAcknowledgement ? "Action" : "Read"}
                </span>
                <ChevronRight size={17} />
              </button>
            </article>
          )) : (
            <div className="student-card student-empty-state student-diary-empty">
              <BookOpenText size={23} />
              <div><strong>No diary entries here</strong><p>Try another filter or check again after teachers publish updates.</p></div>
            </div>
          )}
        </section>
      </div>

      {selected ? (
        <div className="student-sheet-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <section className="student-sheet student-diary-sheet" role="dialog" aria-modal="true" aria-labelledby="student-diary-detail-heading" onClick={(event) => event.stopPropagation()}>
            <div className="student-sheet__handle" />
            <header>
              <span className={`student-diary-entry__icon tone-${selected.kind}`}>{iconForKind(selected.kind, selected.isCatchUp)}</span>
              <div>
                <p>{selected.subject} - {selected.kindLabel}</p>
                <h2 id="student-diary-detail-heading">{selected.title}</h2>
              </div>
              <button className="student-icon-button" type="button" onClick={() => setSelected(null)} aria-label="Close diary detail"><X size={18} /></button>
            </header>
            <p className="student-diary-sheet__body">{selected.body}</p>
            <div className="student-diary-sheet__meta">
              <span><small>Teacher</small><strong>{selected.author}</strong></span>
              <span><small>Published</small><strong>{selected.publishedLabel}</strong></span>
              {selected.dueLabel ? <span><small>Due</small><strong>{selected.dueLabel}</strong></span> : null}
            </div>
            {selected.notes.length ? (
              <div className="student-diary-notes">
                <strong>Conversation</strong>
                {selected.notes.map((item) => <p key={item.id}><b>{item.author}</b> {item.body} <small>{item.createdLabel}</small></p>)}
              </div>
            ) : null}
            {onAddNote ? (
              <div className="student-diary-note-box">
                <label htmlFor="student-diary-note">Add a private note or question</label>
                <textarea id="student-diary-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Example: I finished this but need help with Q7." />
                <button type="button" onClick={submitNote} disabled={busyItemId === selected.id || note.trim().length < 2}><Send size={15} /> Add note</button>
              </div>
            ) : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {selected.requiresAcknowledgement ? (
              <button className="primary-action student-diary-sheet__action" type="button" disabled={selected.acknowledged || busyItemId === selected.id} onClick={() => acknowledge(selected)}>
                <Check size={18} />{selected.acknowledged ? "Already marked done" : selected.kind === "homework" ? "Mark homework done" : "Acknowledge"}
              </button>
            ) : null}
          </section>
        </div>
      ) : null}
      {toast ? <div className="student-toast" role="status"><Check size={18} />{toast}</div> : null}
    </StudentShell>
  );
}
