import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { AccommodationPicker } from "./AccommodationPicker";
import { AccommodationSpaceDialog } from "./AccommodationSpaceDialog";
import { AccommodationReadError, AccommodationWriteFeedback } from "./AccommodationPrimitives";
import { RoomTypeDialog } from "./RoomTypeDialog";
import { RoomTypesDialog } from "./RoomTypesDialog";
import { getAccommodationOptions, getAccommodationRoom, saveAccommodationRoom, type AccommodationRef, type AccommodationRoom, type AllocationMode, type RoomType } from "./accommodationApi";
import { useAccommodationCommand } from "./useAccommodationCommand";

export function AccommodationRoomDialog({ schoolId, actorId, initial, refresh, onClose, onSaved }: { schoolId: string; actorId: string; initial?: AccommodationRoom; refresh: () => Promise<unknown>; onClose: () => void; onSaved: (id: string) => void }) {
  const environment = useExecutionEnvironment(), [current, setCurrent] = useState(initial), [space, setSpace] = useState<AccommodationRef | null>(initial?.space ?? null), [typeId, setTypeId] = useState(initial?.room_type.id ?? "");
  const [capacity, setCapacity] = useState(initial?.sleeping_capacity ?? 1), [mode, setMode] = useState<AllocationMode>(initial?.allocation_mode ?? "shared"), [active, setActive] = useState(initial?.active ?? true), [reason, setReason] = useState("");
  const [choosing, setChoosing] = useState(false), [choosingType, setChoosingType] = useState(false), [newSpace, setNewSpace] = useState(false), [newType, setNewType] = useState(false), [createdType, setCreatedType] = useState<RoomType | null>(null), [reviewing, setReviewing] = useState(false), [error, setError] = useState("");
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["accommodation", schoolId, actorId, "room-setup", typeId]), queryFn: () => getAccommodationOptions(schoolId, { ...(typeId ? { room_type_id: typeId } : {}) }) });
  const write = useAccommodationCommand({ schoolId, ...(initial ? { sourceId: initial.id } : {}), setup: true, onAccepted: async id => { await refresh(); onSaved(id); } });
  const types = [...(options.data?.room_types ?? []), ...(createdType && !options.data?.room_types.some(item => item.id === createdType.id) ? [createdType] : [])];

  const submit = (event: FormEvent) => { event.preventDefault(); if (!space || !typeId) return; const body = { ...(current ? { id: current.id } : {}), space_id: space.id, room_type_id: typeId, sleeping_capacity: capacity, allocation_mode: mode, active, reason: reason.trim(), expected_revision: current?.revision ?? 0 }; void write.execute(command_id => saveAccommodationRoom(schoolId, { ...body, command_id }), current ? { id: current.id, revision: current.revision } : undefined); };
  const review = async () => { if (!current) return; setReviewing(true); setError(""); try { const latest = await getAccommodationRoom(schoolId, current.id); setCurrent(latest); await options.refetch({ throwOnError: true }); write.reviewed(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Room could not be refreshed."); } finally { setReviewing(false); } };
  const locked = write.locked || reviewing || Boolean(options.error);
  return <PlannerDialog title={initial ? "Edit room use" : "Add room"} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={onClose}>
    {options.isPending ? <div className="accommodation-form"><p role="status">Loading room choices…</p></div> : !options.data || !options.data.can_manage ? <div className="accommodation-form"><AccommodationReadError error={options.error ?? new Error("Room setup is not available for your current responsibility.")} onRetry={() => void options.refetch()} /></div> : <form className="accommodation-form" onSubmit={submit}><fieldset disabled={locked}>
      <div className="accommodation-field"><div className="accommodation-heading"><span>Campus room</span>{!initial ? <button type="button" className="is-text" onClick={() => setNewSpace(true)}><Plus size={16} aria-hidden="true" />New location</button> : null}</div><button type="button" className="is-secondary accommodation-select" disabled={Boolean(initial)} onClick={() => setChoosing(true)}>{space?.label ?? "Choose existing location"}</button></div>
      <div className="accommodation-field"><div className="accommodation-heading"><span>Room type</span><button type="button" className="is-text" onClick={() => setNewType(true)}><Plus size={16} aria-hidden="true" />Add type</button></div><button type="button" className="is-secondary accommodation-select" onClick={() => setChoosingType(true)}>{types.find(item => item.id === typeId)?.name ?? current?.room_type.label ?? "Choose type"}</button></div>
      <div className="accommodation-pair"><label>Sleeping capacity<input required type="number" min={1} max={1000} step={1} value={capacity} onChange={event => setCapacity(Number(event.target.value))} /></label><label>Allocation<select value={mode} onChange={event => setMode(event.target.value as AllocationMode)}><option value="shared">Shared places</option><option value="whole_room">Whole room</option></select></label></div>
      <p className="accommodation-caption">{mode === "whole_room" ? "One stay reserves this room exclusively." : "Each stay uses one sleeping place. Named beds are optional."}</p>
      {initial ? <><label className="accommodation-check"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Active residential use</label><label>Reason<textarea required rows={2} minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label></> : null}
      <details><InfoSummary>Room use</InfoSummary><p className="accommodation-caption">This location is dedicated to residential use while active. Capacity changes are checked against existing stays. No furniture or key is issued here.</p></details>
    </fieldset>{error || options.error ? <p role="alert" className="accommodation-error">{error || "Room choices could not refresh. Refresh before saving."}</p> : null}<AccommodationWriteFeedback write={write} onReview={() => void review()} /><footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={onClose}>Cancel</button><button type="submit" disabled={locked || !space || !typeId || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000 || Boolean(initial && reason.trim().length < 3)}>{write.busy ? "Saving…" : "Save room"}</button></footer></form>}
    {choosing ? <AccommodationPicker schoolId={schoolId} actorId={actorId} kind="spaces" title="Choose room location" onClose={() => setChoosing(false)} onSelected={item => { setSpace(item); setChoosing(false); }} /> : null}
    {newSpace ? <AccommodationSpaceDialog schoolId={schoolId} actorId={actorId} campuses={options.data?.campuses ?? []} onClose={() => setNewSpace(false)} onCreated={item => { setSpace(item); setNewSpace(false); }} /> : null}
    {choosingType ? <RoomTypesDialog schoolId={schoolId} actorId={actorId} onClose={() => setChoosingType(false)} onSelected={type => { setCreatedType(type); setTypeId(type.id); if (!initial) { setCapacity(type.default_capacity); setMode(type.allocation_mode); } setChoosingType(false); }} /> : null}
    {newType ? <RoomTypeDialog schoolId={schoolId} refresh={async () => { await options.refetch({ throwOnError: true }); }} onClose={() => setNewType(false)} onSaved={type => { setCreatedType(type); setTypeId(type.id); if (!initial) { setCapacity(type.default_capacity); setMode(type.allocation_mode); } setNewType(false); }} /> : null}
  </PlannerDialog>;
}
