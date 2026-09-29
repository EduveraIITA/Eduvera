import { useMemo, useState } from "react";
import {
  Backpack,
  BookOpenCheck,
  Calculator,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  LockKeyhole,
  Paperclip,
  PenLine,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { fallbackDiaryData } from "./parentDemoData";
import { ParentShell } from "./ParentShell";
import type { ParentDiaryData, ParentPageAction } from "./parentTypes";
import "./parent-pages.css";

export interface ParentDiaryPageProps {
  data?: ParentDiaryData;
  onSelectChild?: (childId: string) => ParentPageAction;
  onSelectDay?: (dayId: string) => ParentPageAction;
  onPackingChange?: (itemId: string, packed: boolean) => ParentPageAction;
  onAcknowledge?: (dayId: string) => ParentPageAction;
  onSendNote?: (body: string) => ParentPageAction;
  onOpenAttachment?: (entryId: string) => ParentPageAction;
}

type AsyncState = "idle" | "pending" | "success" | "error";

function dayHeading(dayId: string, fallback: string) {
  const value = new Date(`${dayId}T00:00:00`);
  if (Number.isNaN(value.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

export function ParentDiaryPage({
  data = fallbackDiaryData,
  onSelectChild,
  onSelectDay,
  onPackingChange,
  onAcknowledge,
  onSendNote,
  onOpenAttachment,
}: ParentDiaryPageProps) {
  const packingStorageKey = `omnischool:packing:${data.child.id}:${data.selectedDayId}`;
  const [selectedDayId, setSelectedDayId] = useState(data.selectedDayId);
  const [packed, setPacked] = useState<Record<string, boolean>>(() => {
    const defaults = Object.fromEntries(data.packingItems.map((item) => [item.id, item.packed]));
    try {
      const saved = window.localStorage.getItem(packingStorageKey);
      return saved ? { ...defaults, ...JSON.parse(saved) as Record<string, boolean> } : defaults;
    } catch {
      return defaults;
    }
  });
  const [fullSchedule, setFullSchedule] = useState(false);
  const [signatureState, setSignatureState] = useState<AsyncState>(data.isAcknowledged ? "success" : "idle");
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<AsyncState>("idle");

  const packedCount = useMemo(() => Object.values(packed).filter(Boolean).length, [packed]);
  const preferredSchedulePreview = data.schedule.filter((period) => period.period === 4 || period.period === 7);
  const schedulePreview = preferredSchedulePreview.length ? preferredSchedulePreview : data.schedule.slice(0, 2);
  const classLabel = `Class ${data.child.grade.replace("Grade ", "")}${data.child.section}`;
  const childFirstName = data.child.name.split(" ")[0] ?? data.child.name;

  const selectDay = async (dayId: string) => {
    setSelectedDayId(dayId);
    await onSelectDay?.(dayId);
  };

  const setPackingItem = async (itemId: string, nextPacked: boolean) => {
    const previous = Boolean(packed[itemId]);
    const next = { ...packed, [itemId]: nextPacked };
    setPacked(next);
    window.localStorage.setItem(packingStorageKey, JSON.stringify(next));
    try {
      await onPackingChange?.(itemId, nextPacked);
    } catch {
      const restored = { ...next, [itemId]: previous };
      setPacked(restored);
      window.localStorage.setItem(packingStorageKey, JSON.stringify(restored));
    }
  };

  const acknowledge = async () => {
    setSignatureState("pending");
    try {
      await onAcknowledge?.(selectedDayId);
      setSignatureState("success");
    } catch {
      setSignatureState("error");
    }
  };

  const sendNote = async () => {
    if (!note.trim()) return;
    setNoteState("pending");
    try {
      await onSendNote?.(note.trim());
      setNote("");
      setNoteState("success");
      window.setTimeout(() => setNoteState("idle"), 4000);
    } catch {
      setNoteState("error");
    }
  };

  return (
    <ParentShell active="diary" pageLabel="Diary" child={data.child} onSelectChild={onSelectChild}>
      <div className="parent-stack diary-page">
        <section className="diary-date-section" aria-labelledby="diary-date-heading">
          <div className="diary-date-section__heading">
            <div><span>{data.termLabel}</span><h1 id="diary-date-heading">{dayHeading(selectedDayId, data.dateHeading)}</h1></div>
            <span className="diary-date-section__calendar" aria-hidden="true"><CalendarDays size={19} /></span>
          </div>
          <div className="diary-day-strip" role="tablist" aria-label={data.weekLabel}>
            {data.days.map((day) => (
              <button
                key={day.id}
                className={selectedDayId === day.id ? "is-selected" : ""}
                type="button"
                role="tab"
                aria-selected={selectedDayId === day.id}
                onClick={() => void selectDay(day.id)}
              >
                {day.isToday ? <em>Today</em> : null}
                <span>{day.weekday}</span>
                <strong>{day.day}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="surface-card diary-overview-card" aria-labelledby="current-diary-period">
          {data.currentPeriod ? <>
            <div className="diary-overview-card__live"><span><i className="presence-dot" />{data.currentPeriod.stateLabel}</span><strong>{data.currentPeriod.dayRangeLabel}</strong></div>
            <div className="diary-current-period">
              <span className="diary-current-period__icon"><Calculator size={20} /></span>
              <div><h2 id="current-diary-period">{data.currentPeriod.subject}</h2><p>{data.currentPeriod.room} - {data.currentPeriod.teacher}</p></div>
              <span>{data.currentPeriod.untilLabel}</span>
            </div>
          </> : <div className="parent-empty-state"><CalendarDays size={21} /><div><strong id="current-diary-period">No classes scheduled</strong><span>This date has no published class periods.</span></div></div>}
          <div className="packing-heading"><span><Backpack size={17} />Bag Packing List <small>Saved on this device</small></span><strong>{packedCount} of {data.packingItems.length} packed</strong></div>
          <div className="packing-list">
            {data.packingItems.length === 0 ? <div className="parent-empty-state"><Backpack size={20} /><div><strong>No packing requests</strong><span>The school has not published items for this date.</span></div></div> : data.packingItems.map((item) => (
              <label key={item.id} className={packed[item.id] ? "is-packed" : ""}>
                <input type="checkbox" checked={Boolean(packed[item.id])} onChange={(event) => void setPackingItem(item.id, event.target.checked)} />
                <span>{item.label}</span>
                <small className={`packing-status packing-status--${item.status}`}>{item.detail}</small>
              </label>
            ))}
          </div>
        </section>

        <section className="diary-schedule-section" aria-labelledby="daily-schedule-heading">
          <div className="diary-section-heading">
            <h2 id="daily-schedule-heading">{classLabel} Daily Schedule</h2>
            <button type="button" aria-expanded={fullSchedule} onClick={() => setFullSchedule((current) => !current)}>
              {fullSchedule ? "Hide Schedule" : "Show Full Day"}{fullSchedule ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
          {fullSchedule ? (
            <div className="surface-card full-schedule-list">
              {data.schedule.map((period) => (
                <article key={period.id} className={period.state ? `is-${period.state}` : ""}>
                  <span>P{period.period}<small>{period.timeLabel}</small></span>
                  <div><strong>{period.subject}</strong><small>{period.location} - {period.teacher}</small></div>
                  {period.state === "complete" ? <CheckCircle2 size={16} /> : period.state === "current" ? <span className="current-label">Ongoing</span> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="schedule-preview-grid">
              {schedulePreview.map((period) => (
                <article className="surface-card" key={period.id}>
                  <span>P{period.period} - {period.timeLabel}</span>
                  <strong>{period.subject}</strong>
                  <small>{period.location}</small>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="teacher-notes" aria-labelledby="teacher-notes-heading">
          <div className="diary-section-heading diary-section-heading--notes">
            <div><h2 id="teacher-notes-heading">Teacher Daily Notes</h2><span>{data.diaryEntries.length} {data.diaryEntries.length === 1 ? "entry" : "entries"} recorded for {childFirstName} on this date</span></div>
            <em>{classLabel} Diary</em>
          </div>
          <div className="teacher-note-list">
            {data.diaryEntries.length === 0 ? <div className="surface-card parent-empty-state"><BookOpenCheck size={21} /><div><strong>No diary entries</strong><span>Teachers have not published notes for this date.</span></div></div> : data.diaryEntries.map((entry) => (
              <article className="surface-card teacher-note" key={entry.id}>
                <div className="teacher-note__title"><h3><i className={`note-dot note-dot--${entry.tone}`} />{entry.subject}</h3><span className={`note-kind note-kind--${entry.tone}`}>{entry.kind}</span></div>
                <p>{entry.body}</p>
                <div className="teacher-note__meta"><span><UserRound size={14} />{entry.author}{entry.timeLabel ? ` - ${entry.timeLabel}` : ""}</span>{entry.verified ? <strong><CheckCircle2 size={14} />Verified</strong> : null}</div>
                {entry.attachmentLabel && onOpenAttachment ? <button type="button" onClick={() => void onOpenAttachment(entry.id)}><Paperclip size={15} />{entry.attachmentLabel}</button> : null}
              </article>
            ))}
          </div>
        </section>

        <section className="surface-card diary-signoff" aria-labelledby="diary-signoff-heading">
          <div className="diary-signoff__heading"><span><PenLine size={20} /></span><div><h2 id="diary-signoff-heading">Daily Parent Sign-off</h2><p>Acknowledgment for {classLabel} diary</p></div></div>
          {signatureState === "success" ? (
            <div className="signed-box" role="status">
              <CheckCircle2 size={23} />
              <div><strong>Digitally Signed & Acknowledged</strong><span>Signed - {data.guardian.name} ({data.guardian.relationship})</span><small>Edura Parent Verified ID: {data.guardian.verifiedId}</small></div>
            </div>
          ) : !data.requiresAcknowledgement ? (
            <div className="signed-box signed-box--neutral" role="status"><CheckCircle2 size={23} /><div><strong>No sign-off required</strong><span>There are no diary items requiring guardian acknowledgment on this date.</span></div></div>
          ) : (
            <div className="signature-box">
              <div className="signature-box__status"><ShieldCheck size={19} /><strong>Acknowledgment Pending</strong></div>
              <p>By signing, you confirm that {data.child.name} has reviewed the homework and preparation requirements shown above.</p>
              <button className="button button--primary button--primary-deep" type="button" disabled={signatureState === "pending"} onClick={() => void acknowledge()}>
                {signatureState === "pending" ? <LoaderCircle className="spin" size={17} /> : <BookOpenCheck size={17} />}
                {signatureState === "pending" ? "Signing..." : "Tap to Sign This Diary"}
              </button>
              {signatureState === "error" ? <p className="form-error" role="alert">The diary could not be signed. Please try again.</p> : null}
            </div>
          )}
        </section>

        <section className="surface-card parent-note-card" aria-labelledby="parent-note-heading">
          <div className="parent-note-card__heading"><PenLine size={19} /><h2 id="parent-note-heading">Parent Note on Daily Diary</h2><span>Visible to<br />Teachers</span></div>
          <label className="sr-only" htmlFor="parent-diary-note">Parent note to homeroom</label>
          <textarea id="parent-diary-note" rows={3} maxLength={500} value={note} disabled={!onSendNote} onChange={(event) => setNote(event.target.value)} placeholder={onSendNote ? "Write a short response or question about this daily diary..." : "A diary item is required before a parent note can be added."} />
          <div className="parent-note-card__actions">
            <span><LockKeyhole size={12} />Private to {classLabel} Staff</span>
            <button className="button button--soft button--small" type="button" disabled={!onSendNote || !note.trim() || noteState === "pending" || noteState === "success"} onClick={() => void sendNote()}>
              {noteState === "pending" ? <LoaderCircle className="spin" size={14} /> : noteState === "success" ? <Check size={14} /> : <Send size={14} />}
              {noteState === "pending" ? "Sending..." : noteState === "success" ? "Note sent" : "Send Note"}
            </button>
          </div>
          {noteState === "success" ? <p className="note-success" role="status"><CheckCircle2 size={14} />Note shared with the {classLabel} homeroom team.</p> : null}
          {noteState === "error" ? <p className="form-error" role="alert">The note could not be sent. Please try again.</p> : null}
        </section>
      </div>
    </ParentShell>
  );
}
