import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Send } from "lucide-react";
import {
  discardDayPlan,
  periodInput,
  publishDayPlan,
  saveDayPlan,
  type DayPlan,
  type DayPeriod,
  type PeriodInput,
  type PlanOptions,
} from "./api";
import { DayPeriodList } from "./DayPeriodList";
import { PeriodEditor } from "./PeriodEditor";
export function PlanEditor({
  plan,
  teachers,
  subjects,
  onSaved,
  onDirty,
}: {
  plan: DayPlan;
  teachers: PlanOptions["teachers"];
  subjects: PlanOptions["subjects"];
  onSaved: () => Promise<void>;
  onDirty?: (dirty: boolean) => void;
}) {
  const version = plan.versions.find((v) => v.version === plan.draft_version)!;
  const [rows, setRows] = useState(plan.periods);
  const [notice, setNotice] = useState(version.notice);
  const [reason, setReason] = useState(version.reason);
  const [revision, setRevision] = useState(plan.revision);
  const [editing, setEditing] = useState<DayPeriod | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"publish" | "discard" | null>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const stale = revision !== plan.revision;
  const [confirmationRevision, setConfirmationRevision] = useState(
    plan.revision,
  );
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        link &&
        link.getAttribute("href")?.startsWith("/") &&
        !window.confirm("Leave this draft without saving your latest edits?")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty]);
  async function run(action: "save" | "publish" | "discard") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const body = {
      school_id: plan.school_id,
      expected_revision: action === "save" ? revision : confirmationRevision,
      ...(action === "save"
        ? { notice, reason, periods: rows.map(periodInput) }
        : {}),
    };
    const fingerprint = JSON.stringify({ action, ...body });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result =
        action === "save"
          ? await saveDayPlan(plan.id, {
              ...body,
              notice,
              reason,
              periods: rows.map(periodInput),
              idempotency_key: retry.current.key,
            })
          : await (action === "publish" ? publishDayPlan : discardDayPlan)(
              plan.id,
              { ...body, idempotency_key: retry.current.key },
            );
      setRevision(result.revision);
      setDirty(false);
      retry.current = null;
      setConfirm(null);
      await onSaved();
      setMessage(
        action === "save"
          ? "Draft saved. Review the checks before publishing."
          : "",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The plan could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  function apply(value: PeriodInput) {
    setRows((current) => {
      const old = current.find((p) => p.period_number === value.period_number);
      const next = {
        ...old,
        ...value,
        id: old?.id ?? `new-${value.period_number}`,
        teacher_name:
          teachers.find((t) => t.id === value.teacher_user_id)?.name ?? null,
        coverage_status: "not_required" as const,
        response_note: "",
        response_revision: 0,
        response_source: null,
        responded_at: null,
      };
      return [
        ...current.filter((p) => p.period_number !== value.period_number),
        next,
      ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    });
    setDirty(true);
  }
  function add() {
    const n = Array.from({ length: 24 }, (_, i) => i + 1).find(
      (n) => !rows.some((p) => p.period_number === n),
    );
    if (!n) return;
    setEditing({
      id: `new-${n}`,
      period_number: n,
      starts_at: "14:00",
      ends_at: "14:45",
      title: "",
      slot_type: "class",
      room: "",
      teacher_user_id: null,
      cancelled: false,
      materials: [],
      teacher_name: null,
      coverage_status: "unassigned",
      response_revision: 0,
      response_note: "",
      response_source: null,
      responded_at: null,
    });
  }
  return (
    <section className="day-panel day-editor" aria-labelledby="draft-heading">
      <header className="day-heading">
        <div>
          <span className="day-eyebrow">Draft · not shared</span>
          <h2 id="draft-heading">Prepare the day</h2>
        </div>
        <span className="day-status is-pending">
          {dirty ? "Unsaved edits" : `Revision ${revision}`}
        </span>
      </header>
      {error ? (
        <p role="alert" className="day-error">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="day-success">
          {message}
        </p>
      ) : null}
      {stale ? (
        <p role="alert" className="day-error">
          The plan changed in another session. Your edits are kept here.{" "}
          <button type="button" onClick={() => location.reload()}>
            Reload latest plan
          </button>
        </p>
      ) : null}
      <fieldset disabled={busy || stale}>
        <label>
          Notice for families
          <textarea
            value={notice}
            rows={2}
            maxLength={1200}
            placeholder="What should families know about this date?"
            onChange={(e) => {
              setNotice(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <DayPeriodList
          periods={rows}
          showCoverage={false}
          onEdit={setEditing}
        />
        <button
          className="day-secondary"
          type="button"
          disabled={rows.length >= 24}
          onClick={add}
        >
          <Plus size={16} />
          Add period
        </button>
        <label className="day-change-reason">
          Reason for this change
          <textarea
            value={reason}
            rows={2}
            maxLength={500}
            placeholder="For the school's revision history"
            onChange={(e) => {
              setReason(e.target.value);
              setDirty(true);
            }}
          />
        </label>
      </fieldset>
      {!dirty && plan.conflicts.length ? (
        <section className="day-error" aria-label="Scheduling conflicts">
          <strong>Resolve before publishing</strong>
          <ul>
            {plan.conflicts.map((c, i) => (
              <li key={i}>
                P{c.period_number}: {c.type} overlaps {c.class_name}, P
                {c.other_period}.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <footer className="day-actions">
        <button
          type="button"
          className="day-secondary"
          disabled={busy || stale}
          onClick={() => {
            setConfirmationRevision(revision);
            setConfirm("discard");
          }}
        >
          Discard draft
        </button>
        <div>
          <button
            type="button"
            className="day-secondary"
            disabled={busy || (!dirty && !error) || (stale && !error)}
            onClick={() => void run("save")}
          >
            <Pencil size={16} />
            {busy ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="day-primary"
            disabled={
              busy ||
              stale ||
              dirty ||
              !!plan.conflicts.length ||
              !reason.trim()
            }
            onClick={() => {
              setConfirmationRevision(revision);
              setConfirm("publish");
            }}
          >
            <Send size={16} />
            Review & publish
          </button>
        </div>
      </footer>
      {editing ? (
        <PeriodEditor
          key={editing.id}
          period={editing}
          teachers={teachers}
          subjects={subjects}
          onSave={apply}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirm ? (
        <PlanConfirmation
          kind={confirm}
          plan={plan}
          busy={busy}
          error={error}
          onClose={() => setConfirm(null)}
          onConfirm={() => void run(confirm)}
        />
      ) : null}
    </section>
  );
}
function PlanConfirmation({
  kind,
  plan,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  kind: "publish" | "discard";
  plan: DayPlan;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      className="day-dialog"
      ref={dialog}
      aria-labelledby="publish-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <header>
        <span className="day-eyebrow">{plan.date}</span>
        <h2 id="publish-title">
          {kind === "publish"
            ? "Publish this day plan?"
            : "Discard this draft?"}
        </h2>
      </header>
      {kind === "publish" ? (
        <>
          <p>
            {plan.periods.filter((p) => !p.cancelled).length} active periods ·{" "}
            {plan.periods.filter((p) => p.cancelled).length} cancelled. Families
            will see this version in Home and Timetable.
          </p>
          <p>
            Changed teacher assignments will request a coverage response. The
            publishing administrator owns unresolved coverage.
          </p>
          <label className="day-checkbox">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            I have reviewed the schedule and arrangements.
          </label>
        </>
      ) : (
        <p>
          The current published plan stays unchanged. This draft remains in
          revision history.
        </p>
      )}
      {error ? (
        <p role="alert" className="day-error">
          {error}
        </p>
      ) : null}
      <footer className="day-actions">
        <button className="day-secondary" disabled={busy} onClick={onClose}>
          Go back
        </button>
        <button
          className="day-primary"
          disabled={busy || (kind === "publish" && !verified)}
          onClick={onConfirm}
        >
          {busy
            ? "Saving…"
            : kind === "publish"
              ? "Publish day plan"
              : "Discard draft"}
        </button>
      </footer>
    </dialog>
  );
}
