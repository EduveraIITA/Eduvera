import { useEffect, useRef, useState } from "react";
import {
  periodInput,
  type DayPeriod,
  type PeriodInput,
  type PlanOptions,
} from "./api";
export function PeriodEditor({
  period,
  teachers,
  subjects,
  onSave,
  onClose,
}: {
  period: DayPeriod;
  teachers: PlanOptions["teachers"];
  subjects: PlanOptions["subjects"];
  onSave: (p: PeriodInput) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(() => periodInput(period));
  const [materials, setMaterials] = useState(period.materials.join("\n"));
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  function submit() {
    if (value.ends_at <= value.starts_at) {
      setError("End time must follow start time.");
      return;
    }
    const items = [
      ...new Set(
        materials
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    if (items.length > 12 || items.some((v) => v.length > 120)) {
      setError("Use up to 12 materials, each no longer than 120 characters.");
      return;
    }
    onSave({ ...value, materials: items });
    onClose();
  }
  return (
    <dialog
      className="day-dialog"
      ref={dialog}
      aria-labelledby="day-period-title"
      onCancel={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="day-heading">
          <div>
            <span className="day-eyebrow">Period {period.period_number}</span>
            <h2 id="day-period-title">Period details</h2>
          </div>
          <button className="day-secondary" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {error ? (
          <p role="alert" className="day-error">
            {error}
          </p>
        ) : null}
        <label>
          Period name
          <input
            required
            value={value.title}
            maxLength={120}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </label>
        <label>
          Linked subject
          <select
            value={value.subject_id ?? ""}
            onChange={(e) =>
              setValue({
                ...value,
                subject_id: e.target.value || null,
                title:
                  subjects.find((s) => s.id === e.target.value)?.name ??
                  value.title,
              })
            }
          >
            <option value="">Activity / no subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="day-form-grid">
          <label>
            Type
            <select
              value={value.slot_type}
              onChange={(e) =>
                setValue({
                  ...value,
                  slot_type: e.target.value as PeriodInput["slot_type"],
                })
              }
            >
              <option value="class">Class</option>
              <option value="activity">Activity</option>
              <option value="break">Break</option>
            </select>
          </label>
          <label>
            Room
            <input
              value={value.room}
              maxLength={80}
              onChange={(e) => setValue({ ...value, room: e.target.value })}
            />
          </label>
          <label>
            Starts at
            <input
              required
              type="time"
              value={value.starts_at}
              onChange={(e) =>
                setValue({ ...value, starts_at: e.target.value })
              }
            />
          </label>
          <label>
            Ends at
            <input
              required
              type="time"
              value={value.ends_at}
              onChange={(e) => setValue({ ...value, ends_at: e.target.value })}
            />
          </label>
        </div>
        <label>
          Assigned teacher
          <select
            value={value.teacher_user_id ?? ""}
            onChange={(e) =>
              setValue({ ...value, teacher_user_id: e.target.value || null })
            }
          >
            <option value="">Not assigned</option>
            {teachers.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Materials to bring
          <textarea
            rows={3}
            value={materials}
            maxLength={1500}
            placeholder="One item per line"
            onChange={(e) => setMaterials(e.target.value)}
          />
        </label>
        <label className="day-checkbox">
          <input
            type="checkbox"
            checked={value.cancelled}
            onChange={(e) =>
              setValue({ ...value, cancelled: e.target.checked })
            }
          />
          Cancel this period for this date
        </label>
        <footer className="day-actions">
          <button type="button" className="day-secondary" onClick={onClose}>
            Cancel edit
          </button>
          <button className="day-primary">Apply to draft</button>
        </footer>
      </form>
    </dialog>
  );
}
