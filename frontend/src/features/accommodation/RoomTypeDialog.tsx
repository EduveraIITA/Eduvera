import { useState, type FormEvent } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { getAccommodationOptions, saveRoomType, type AllocationMode, type RoomType } from "./accommodationApi";
import { AccommodationWriteFeedback } from "./AccommodationPrimitives";
import { useAccommodationCommand } from "./useAccommodationCommand";

export function RoomTypeDialog({ schoolId, initial, refresh, onClose, onSaved }: { schoolId: string; initial?: RoomType; refresh: () => Promise<unknown>; onClose: () => void; onSaved: (type: RoomType) => void }) {
  const [current, setCurrent] = useState(initial), [name, setName] = useState(initial?.name ?? ""), [capacity, setCapacity] = useState(initial?.default_capacity ?? 1);
  const [mode, setMode] = useState<AllocationMode>(initial?.allocation_mode ?? "shared"), [active, setActive] = useState(initial?.active ?? true), [reviewing, setReviewing] = useState(false), [error, setError] = useState(""), [reason, setReason] = useState("");
  const write = useAccommodationCommand({ schoolId, ...(initial ? { sourceId: initial.id } : {}), setup: true, onAccepted: async (id, result) => {
    await refresh(); const fresh = await getAccommodationOptions(schoolId, { room_type_id: id }); const type = fresh.room_types.find(item => item.id === id);
    if (!type && result && typeof result === "object" && "name" in result) onSaved(result as RoomType);
    else if (type) onSaved(type); else throw new Error("Saved room type could not be loaded. Refresh this saved record.");
  } });
  const submit = (event: FormEvent) => {
    event.preventDefault(); const body = { ...(current ? { id: current.id } : {}), name: name.trim(), default_capacity: capacity, allocation_mode: mode, active, reason: reason.trim(), expected_revision: current?.revision ?? 0 };
    void write.execute(command_id => saveRoomType(schoolId, { ...body, command_id }), current ? { id: current.id, revision: current.revision } : undefined);
  };
  const review = async () => { if (!current) return; setReviewing(true); setError(""); try { const data = await getAccommodationOptions(schoolId, { room_type_id: current.id }); const next = data.room_types.find(item => item.id === current.id); if (!next) throw new Error("This room type is no longer available."); setCurrent(next); write.reviewed(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Current type unavailable."); } finally { setReviewing(false); } };
  return <PlannerDialog title={initial ? "Edit room type" : "Add room type"} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={onClose}><form className="accommodation-form" onSubmit={submit}><fieldset disabled={write.locked || reviewing}>
    <label>Name<input autoFocus required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Twin, dormitory, staff…" /></label>
    <div className="accommodation-pair"><label>Default sleeping places<input type="number" min={1} max={1000} step={1} required value={capacity} onChange={event => setCapacity(Number(event.target.value))} /></label><label>Allocation<select value={mode} onChange={event => setMode(event.target.value as AllocationMode)}><option value="shared">Shared places</option><option value="whole_room">Whole room</option></select></label></div>
    {initial ? <label className="accommodation-check"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Available for new rooms</label> : null}
    {initial ? <label>Reason<textarea required rows={2} minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label> : null}<details><InfoSummary>Type defaults</InfoSummary><p className="accommodation-caption">Defaults help create rooms. Changing a type does not change existing capacity, furniture or accepted stays.</p></details>
  </fieldset>{error ? <p role="alert" className="accommodation-error">{error}</p> : null}<AccommodationWriteFeedback write={write} onReview={() => void review()} /><footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={onClose}>Cancel</button><button type="submit" disabled={write.locked || reviewing || name.trim().length < 2 || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000 || Boolean(initial && reason.trim().length < 3)}>{write.busy ? "Saving…" : "Save type"}</button></footer></form></PlannerDialog>;
}
