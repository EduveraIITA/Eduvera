import { useEffect, useRef, useState } from "react";
import { respondCoverage, type DayPeriod } from "./api";
export function CoverageResponse({
  schoolId,
  period,
  assisted = false,
  onSaved,
  onClose,
}: {
  schoolId: string;
  period: DayPeriod;
  assisted?: boolean;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"accepted" | "declined">("accepted");
  const [note, setNote] = useState("");
  const [source, setSource] = useState<"phone" | "paper" | "in_person">(
    "phone",
  );
  const [received, setReceived] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 19);
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [revision] = useState(period.response_revision);
  const stale = revision !== period.response_revision;
  useEffect(() => {
    const prior = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (prior instanceof HTMLElement) prior.focus();
    };
  }, []);
  async function save() {
    if (busy || stale) return;
    setBusy(true);
    setError("");
    const body = {
      school_id: schoolId,
      expected_revision: revision,
      status,
      note,
      source: assisted ? source : ("app" as const),
      ...(assisted ? { received_at: new Date(received).toISOString() } : {}),
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await respondCoverage(period.id, {
        ...body,
        idempotency_key: pending.current.key,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The response could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="day-dialog"
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="coverage-title"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header>
          <span className="day-eyebrow">
            P{period.period_number} · {period.title}
          </span>
          <h2 id="coverage-title">
            {assisted ? "Record teacher response" : "Respond to assignment"}
          </h2>
          <p>
            {assisted
              ? `${period.teacher_name} · entered by the school office`
              : "Confirm availability for this published period."}
          </p>
        </header>
        {error ? (
          <p role="alert" className="day-error">
            {error}
          </p>
        ) : null}
        {stale ? (
          <p role="alert" className="day-error">
            This response changed. Close and reopen the latest assignment.
          </p>
        ) : null}
        <fieldset disabled={busy}>
          <label>
            Response
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="accepted">Available · accept assignment</option>
              <option value="declined">
                Unavailable · school needs to reassign
              </option>
            </select>
          </label>
          {assisted ? (
            <div className="day-form-grid">
              <label>
                Received through
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  <option value="phone">Phone call</option>
                  <option value="in_person">In person</option>
                  <option value="paper">Paper</option>
                </select>
              </label>
              <label>
                Received at
                <input
                  type="datetime-local"
                  step="1"
                  required
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          <label>
            {assisted
              ? "Record of response"
              : status === "declined"
                ? "Reason unavailable"
                : "Note (optional)"}
            <textarea
              required={assisted || status === "declined"}
              maxLength={500}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </fieldset>
        <footer className="day-actions">
          <button
            type="button"
            className="day-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="day-primary" disabled={busy || stale}>
            {busy ? "Saving…" : "Save response"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
