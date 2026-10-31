import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import { createSpace } from "../office/api";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { InfoSummary } from "../../components/InfoSummary";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import "./activity-place-create.css";

export interface ActivityCampusChoice { id: string; label: string; is_primary: boolean }

export function ActivityPlaceQuickCreate({ schoolId, campuses, onClose, onCreated }: {
  schoolId: string; campuses: ActivityCampusChoice[]; onClose: () => void;
  onCreated: (place: { id: string; label: string; campus_id: string }) => void;
}) {
  const [name, setName] = useState("");
  const [campusId, setCampusId] = useState(() => campuses.find((campus) => campus.is_primary)?.id ?? (campuses.length === 1 ? campuses[0]?.id ?? "" : ""));
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const pending = useRef(false), retained = useRef<object | null>(null);
  const [error, setError] = useState("");
  useUnsavedChangesGuard(busy || unknown, "Place creation is not confirmed. Stay here and retry the same creation.");
  const changed = () => { setRetryKey(crypto.randomUUID()); setError(""); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return; setError("");
    if (name.trim().length < 2) return setError("Give this place a name of at least two characters.");
    if (campuses.length > 1 && !campusId) return setError("Choose the campus this place belongs to.");
    pending.current = true; setBusy(true);
    try {
      const prefix = name.trim().normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28).toUpperCase() || "PLACE";
      retained.current ??= {
        ...(campusId ? { campus_id: campusId } : {}), create_campus_if_missing: true,
        name: name.trim(), code: `${prefix}_${retryKey.slice(0, 8).toUpperCase()}`,
        parent_space_id: null, kind: "other", capacity: null,
        is_accessible: false, is_bookable: true, status: "active", idempotency_key: retryKey,
      };
      const place = await createSpace(schoolId, retained.current);
      if (!place?.id || !place.name) throw new Error("The place could not be confirmed. Retry the same creation.");
      setUnknown(false);
      onCreated({ id: place.id, label: place.name, campus_id: place.campus_id });
    } catch (cause) {
      const definite = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 409;
      setUnknown(!definite); if (definite) { retained.current = null; setRetryKey(crypto.randomUUID()); }
      setError(cause instanceof Error ? cause.message : "This place could not be saved. Your details are still here.");
    }
    finally { pending.current = false; setBusy(false); }
  }
  return <PlannerDialog title="Add campus place" onClose={onClose} busy={busy || unknown}>
    <form className="activity-form activity-place-create" onSubmit={(event) => void submit(event)}>
      <fieldset className="activity-place-form-fields" disabled={busy || unknown}>
      <label>Place name<input autoFocus required minLength={2} maxLength={160} value={name} onChange={(event) => { changed(); setName(event.target.value); }} placeholder="e.g. Main entrance" /></label>
      {campuses.length > 1 ? <label>Campus<select required value={campusId} onChange={(event) => { changed(); setCampusId(event.target.value); }}><option value="">Choose campus</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.label}{campus.is_primary ? " (primary)" : ""}</option>)}</select></label> : campuses.length === 1 ? <p>Campus: {campuses[0]?.label}</p> : <p>Your primary campus will also be created.</p>}
      <details><InfoSummary>Place details</InfoSummary><p>This place can be reused across activities. Add its type, capacity and other details later in Campus setup.</p></details>
      </fieldset>
      {error ? <p className="activity-error" role="alert">{error}</p> : null}
      {unknown ? <p className="activity-note" role="status">The result is uncertain. Retry this unchanged creation; do not add another place.</p> : null}
      <footer><button type="button" className="is-secondary" disabled={busy || unknown} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || name.trim().length < 2 || campuses.length > 1 && !campusId}>{busy ? "Adding…" : unknown ? "Retry same creation" : "Add place"}</button></footer>
    </form>
  </PlannerDialog>;
}
