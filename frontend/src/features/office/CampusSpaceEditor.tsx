import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import "./office.css";
import "./campus-space-editor.css";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { X } from "lucide-react";
import { createSpace, updateSpace, type CampusSpace, type InstitutionSetup } from "./api";

const spaceKinds: Record<CampusSpace["kind"], string> = { building: "Building", hostel: "Hostel", residential_room: "Residential room", wing: "Wing", floor: "Floor", classroom: "Classroom", laboratory: "Laboratory", library: "Library", office: "Office", auditorium: "Auditorium", sports_area: "Sports area", workshop: "Workshop", staff_room: "Staff room", gate: "Gate", outdoor_area: "Outdoor area", virtual: "Virtual space", other: "Other" };
export interface CampusSpaceDefaults { name?: string; kind?: CampusSpace["kind"]; parent_space_id?: string | null }
interface Props {
  schoolId: string;
  data: Pick<InstitutionSetup, "campuses" | "spaces">;
  campusId: string;
  space?: CampusSpace;
  defaults?: CampusSpaceDefaults;
  fixedCampus?: boolean;
  onClose: () => void;
  onBeforeLeaveChange?: (guard: (() => boolean) | null) => void;
  onSaved: (space: CampusSpace) => Promise<void> | void;
}

/** One canonical campus-place form, reused in setup and beside a drawing. */
export function CampusSpaceEditor({ schoolId, data, campusId, space, defaults, fixedCampus = false, onClose, onSaved, onBeforeLeaveChange }: Props) {
  const id = useId(), heading = useRef<HTMLHeadingElement>(null), dialog = useRef<HTMLElement>(null);
  const [campus, setCampus] = useState(space?.campus_id ?? campusId);
  const [parent, setParent] = useState(space?.parent_space_id ?? defaults?.parent_space_id ?? "");
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState("");
  const beforeLeave = useUnsavedChangesGuard(busy || unknown, "Place creation is not confirmed. Stay here and retry the same creation.");
  useEffect(() => { onBeforeLeaveChange?.(beforeLeave); return () => onBeforeLeaveChange?.(null); }, [beforeLeave, onBeforeLeaveChange]);
  const attempt = useRef<{ signature: string; key: string; body: object } | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; heading.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  const candidateSpaces = data.spaces.filter(item => item.campus_id === campus && (item.status === "active" || item.id === space?.parent_space_id) && item.id !== space?.id);
  const validParent = candidateSpaces.some(item => item.id === parent) ? parent : "";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    const form = new FormData(event.currentTarget), text = (name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
    const input = { campus_id: campus, parent_space_id: validParent || null, name: text("name"), code: text("code"), kind: text("kind"), capacity: text("capacity") ? Number(text("capacity")) : null, is_accessible: form.has("is_accessible"), is_bookable: form.has("is_bookable"), status: text("status") };
    try {
      let saved: CampusSpace;
      if (space) saved = await updateSpace(schoolId, space.id, { ...input, expected_revision: space.revision });
      else {
        const signature = JSON.stringify(input);
        if (!unknown && attempt.current?.signature !== signature) { const key = crypto.randomUUID(); attempt.current = { signature, key, body: { ...input, create_campus_if_missing: true, idempotency_key: key } }; }
        saved = await createSpace(schoolId, attempt.current!.body);
      }
      if (active.current) { setUnknown(false); await onSaved(saved); }
    } catch (cause) { if (active.current) { setUnknown(!space && !(cause instanceof ApiError && cause.status >= 400 && cause.status < 500)); setError(cause instanceof Error ? cause.message : "This place could not be saved. Your details are still here."); } }
    finally { if (active.current) setBusy(false); }
  }
  const title = space ? "Edit space" : "Add space";
  return <div className="office-sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy && !unknown) onClose(); }} onKeyDown={event => {
    if (event.key === "Escape" && !busy && !unknown) { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]');
    const first = controls?.[0], last = controls?.[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><section ref={dialog} className="office-sheet campus-replica__sheet" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <div className="office-sheet__handle"/><header className="office-sheet__header"><div><span>Campus place</span><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{title}</h2><p id={`${id}-description`}>Add one place now. Capacity, access and other details can be completed when needed.</p></div><button type="button" aria-label="Close" disabled={busy || unknown} onClick={onClose}><X size={20}/></button></header>
    <form className="office-form campus-replica__form" onSubmit={event => void submit(event)}><fieldset disabled={busy || unknown} className="campus-space-fields">
      <label className="office-field">Campus<select name="campus_id" value={campus} disabled={fixedCampus} required onChange={event => { setCampus(event.target.value); setParent(""); }}>{data.campuses.filter(item => item.status === "active" || item.id === campus).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="office-field">Space name<input name="name" minLength={2} maxLength={160} required defaultValue={space?.name ?? defaults?.name}/></label>
      <div className="office-form-grid"><label className="office-field">Code<input name="code" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,39}" maxLength={40} required defaultValue={space?.code}/><small>A short unique code, such as LIB or A201.</small></label><label className="office-field">Type<select name="kind" defaultValue={space?.kind ?? defaults?.kind ?? "classroom"}>{Object.entries(spaceKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label></div>
      <label className="office-field">Inside (optional)<select aria-label="Inside (optional)" name="parent_space_id" value={validParent} onChange={event => setParent(event.target.value)}><option value="">Campus level</option>{candidateSpaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Choose its actual building or floor. A drawing does not create this relationship.</small></label>
      <details className="campus-scene-disclosure"><summary>Capacity and other details (optional)</summary><div className="office-form-grid"><label className="office-field">Capacity<input name="capacity" type="number" min="1" max="100000" defaultValue={space?.capacity ?? ""}/></label><label className="office-field">Status<select name="status" defaultValue={space?.status ?? "active"}><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div><div className="campus-replica__checks"><label className="office-check"><input type="checkbox" name="is_bookable" defaultChecked={space?.is_bookable ?? false}/> Can be booked</label><label className="office-check"><input type="checkbox" name="is_accessible" defaultChecked={space?.is_accessible ?? false}/> Accessible space</label></div></details>
    </fieldset>{error ? <p className="office-alert" role="alert">{error}</p> : null}{unknown ? <p role="status">The result is uncertain. Retry this unchanged creation to confirm it.</p> : null}<div className="office-actions office-sheet__actions"><button type="button" className="office-secondary" disabled={busy || unknown} onClick={onClose}>Cancel</button><button type="submit" className="office-primary" disabled={busy || !campus}>{busy ? "Saving…" : unknown ? "Retry same creation" : "Save"}</button></div></form>
  </section></div>;
}
