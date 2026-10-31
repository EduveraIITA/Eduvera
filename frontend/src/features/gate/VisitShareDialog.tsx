import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { ApiError } from "../../lib/api";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { deliveryLabel, invitePersonToApp, type ReadyInvitation } from "../onboarding/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getVisitOptions, type ArrangedVisit, type VisitPerson } from "./visitApi";
import { getVisitSharing, shareVisit, type VisitSharing } from "./visitSharingApi";
import { useVisitSharingCommand, VisitSharingFeedback } from "./useVisitSharingCommand";
import { VisitPicker } from "./VisitPicker";

const localDate = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function inviteNotCreated(cause: unknown, key: string) {
  if (!(cause instanceof ApiError) || cause.status !== 409 || !cause.details || typeof cause.details !== "object") return false;
  const body = cause.details as { error?: { code?: string; fields?: { person_invitation?: { confirmation?: string; idempotency_key?: string } } }; code?: string; fields?: { person_invitation?: { confirmation?: string; idempotency_key?: string } } }, detail = body.error ?? body;
  return ["person_invitation_exists", "person_invitation_account_exists"].includes(detail.code ?? "") && detail.fields?.person_invitation?.confirmation === "not_created" && detail.fields.person_invitation.idempotency_key === key;
}
export function VisitShareDialog({ schoolId, actorId, visit, initial, refresh, onClose }: {
  schoolId: string; actorId: string; visit: ArrangedVisit; initial: VisitSharing; refresh: () => Promise<unknown>; onClose: () => void;
}) {
  const world = useExecutionEnvironment(), active = useRef(true), invitationKey = useRef(crypto.randomUUID());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [sharing, setSharing] = useState(initial), [person, setPerson] = useState<VisitPerson | null>(initial.current?.organiser ?? visit.person), [choosing, setChoosing] = useState(false);
  const [until, setUntil] = useState(localDate(initial.current?.ends_at ?? visit.ends_at)), [directions, setDirections] = useState(initial.current?.directions ?? ""), [email, setEmail] = useState(initial.current?.invitation?.email ?? "");
  const [saved, setSaved] = useState<VisitSharing["current"]>(null), [invitation, setInvitation] = useState<ReadyInvitation | null>(null), [sending, setSending] = useState(false), [unknown, setUnknown] = useState(false), [refused, setRefused] = useState(false), [error, setError] = useState("");
  const selected = useQuery({ queryKey: executionEnvironmentQueryKey(world, ["gate-visits", schoolId, actorId, "share-person", person?.id]), queryFn: ({ signal }) => getVisitOptions(schoolId, { person_id: person!.id }, signal), enabled: Boolean(person && person.has_app_access === undefined), retry: false });
  const chosen = person?.has_app_access !== undefined ? person : selected.data?.people.find(item => item.id === person?.id);
  const retainedOwner = initial.current?.organiser.id === chosen?.id && initial.current?.state !== "party_changed" ? initial.current?.owner : null;
  const send = async (access: NonNullable<VisitSharing["current"]>) => {
    if (!active.current || world.mode !== "live" || sending) return;
    setSending(true); setError("");
    try {
      const result = await invitePersonToApp(schoolId, { email: email.trim().toLowerCase(), role: "member", person_id: access.organiser.id, idempotency_key: invitationKey.current, work_context: { kind: "visit_arrangement", source_id: visit.id, access_id: access.id } });
      if (active.current) { setInvitation(result); setUnknown(false); setRefused(false); try { await refresh(); } catch { if (active.current) setError("Invitation created. The view could not refresh; your saved sharing is retained."); } }
    } catch (cause) { if (active.current) { const definite = inviteNotCreated(cause, invitationKey.current) || !unknown && cause instanceof ApiError && [400, 401, 403, 404, 410, 422].includes(cause.status); setUnknown(!definite); setRefused(definite); setError(`Visit shared. The app invitation was ${definite ? "not created" : "not confirmed"}. ${cause instanceof Error ? cause.message : "Retry the same invitation here."}`); } }
    finally { if (active.current) setSending(false); }
  };
  const write = useVisitSharingCommand<VisitSharing>({ schoolId, visitId: visit.id, accepts: receipt => ["shared", "renewed"].includes(receipt.action), onAccepted: async (result, receipt) => {
    const current = result ?? await getVisitSharing(schoolId, visit.id);
    if (!active.current) return;
    if (!current.current || current.current.organiser.id !== chosen?.id || receipt && current.current.id !== receipt.share_id) throw new Error("Sharing was saved, but this organiser’s current access could not be loaded.");
    setSaved(current.current);
    if (current.current.organiser.has_app_access || world.mode !== "live") { await refresh(); onClose(); }
    else if (current.current.invitation) { await refresh(); onClose(); }
    else await send(current.current);
  } });
  const locked = write.locked || sending || Boolean(saved), dirty = person?.id !== (initial.current?.organiser.id ?? visit.person?.id) || directions !== (initial.current?.directions ?? "") || until !== localDate(initial.current?.ends_at ?? visit.ends_at) || email !== (initial.current?.invitation?.email ?? "");
  const canLeave = useUnsavedChangesGuard(!saved && dirty && !write.busy && !write.recovery, "Discard this unfinished visit share?");
  const close = () => { if (!write.busy && !sending && !unknown && write.recovery !== "unknown" && (saved || canLeave())) onClose(); };
  const valid = chosen?.has_app_access !== undefined && Number.isFinite(Date.parse(until)) && Boolean(chosen.has_app_access || world.mode !== "live" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const submit = (event: FormEvent) => { event.preventDefault(); if (!chosen || !valid || locked) return; const body = { expected_revision: sharing.share_revision, expected_visit_revision: sharing.visit_revision, organiser_person_id: chosen.id, organiser_person_revision: chosen.revision, ends_at: new Date(until).toISOString(), directions: directions.trim() }; void write.execute(command_id => shareVisit(schoolId, visit.id, { ...body, command_id }), body.expected_revision); };
  const review = async () => { const current = await getVisitSharing(schoolId, visit.id); if (!active.current) return; if (!current.can_share) { setError("Sharing is no longer available. Close and review the visit."); return; } setSharing(current); write.reviewed(); };
  return <PlannerDialog title="Share visit" subtitle={visit.title} onClose={close} busy={write.busy || sending || unknown || write.recovery === "unknown"}><form className="visits-form" onSubmit={submit}>
    {saved ? <div className="visits-summary" role="status"><strong>Visit shared with {saved.organiser.label}</strong><p className="visits-caption">{invitation ? deliveryLabel(invitation.delivery) || "Email delivery is unavailable or unconfirmed." : unknown ? "App invitation not confirmed" : "Preparing app invitation…"}</p></div> : null}
    <fieldset disabled={locked}><div className="visits-field"><span>Organiser</span><button type="button" className="is-secondary visits-select" onClick={() => setChoosing(true)}>{person?.label ?? "Choose person"}</button></div>
      {person && !chosen && selected.isPending ? <p role="status" className="visits-caption">Checking app access…</p> : null}{selected.error ? <p className="visits-error" role="alert">The organiser could not be checked. Choose them again.</p> : null}
      <label>Directions <small className="visits-caption">Optional · shared with the organiser</small><textarea rows={3} maxLength={1000} value={directions} onChange={event => setDirections(event.target.value)} /></label>
      <label>Available until<TemporalInput type="datetime-local" required value={until} onChange={event => setUntil(event.target.value)} /></label>
      <p className="visits-caption">{Intl.DateTimeFormat().resolvedOptions().timeZone} · {retainedOwner ? `Questions stay with ${retainedOwner.label}.` : "Questions come to you."}</p>
      {chosen && !chosen.has_app_access && world.mode === "live" ? <label>Invitation email<input type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></label> : null}
      {chosen && !chosen.has_app_access && world.mode !== "live" ? <p className="visits-caption">This run rehearses sharing. Real invitations and accounts stay in Live.</p> : null}
    </fieldset>
    {saved && refused ? <label>Invitation email<input type="email" required value={email} onChange={event => { setEmail(event.target.value); invitationKey.current = crypto.randomUUID(); }} /></label> : null}
    {error ? <p className="visits-error" role="alert">{error}</p> : null}{!saved ? <VisitSharingFeedback write={write} onReview={() => void review().catch(cause => setError(cause instanceof Error ? cause.message : "The visit could not be checked."))} /> : null}
    <footer>{saved ? <><button type="button" className="is-secondary" disabled={sending || unknown} onClick={close}>Done</button>{unknown || refused ? <button type="button" disabled={sending || !email.trim()} onClick={() => void send(saved)}>{sending ? "Checking…" : unknown ? "Retry same invitation" : "Send invitation"}</button> : null}</> : <><button type="button" className="is-secondary" disabled={write.busy || write.recovery === "unknown"} onClick={close}>Cancel</button><button type="submit" disabled={locked || !valid}>{write.busy ? "Sharing…" : "Share visit"}</button></>}</footer>
  </form>{choosing ? <VisitPicker schoolId={schoolId} actorId={actorId} kind="people" title="Choose organiser" allowAdd onClose={() => setChoosing(false)} onSelected={value => { setPerson(value as VisitPerson); setChoosing(false); }} /> : null}</PlannerDialog>;
}
