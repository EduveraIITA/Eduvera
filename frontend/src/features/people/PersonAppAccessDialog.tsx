import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { InvitationReceipt } from "../onboarding/InvitationReceipt";
import { deliveryLabel, deliveryPending, getMemberInvitation, invitationState, invitePersonToApp, resendMemberInvitation, revokeMember, type ReadyInvitation } from "../onboarding/api";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import type { CampusParticipant, CampusPersonInvitation } from "./participationApi";

export function PersonAppAccessDialog({ schoolId, person, onClose, onChanged }: {
  schoolId: string; person: CampusParticipant; onClose: () => void; onChanged: () => void;
}) {
  const environment = useExecutionEnvironment();
  const live = environment.mode === "live";
  const [email, setEmail] = useState("");
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState<CampusPersonInvitation | null>(person.pending_invitation ?? null);
  const [ready, setReady] = useState<ReadyInvitation | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const acceptedSeen = useRef<string | null>(null);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; }, [onChanged]);
  const detail = useQuery({
    queryKey: executionEnvironmentQueryKey(environment, ["people.app-invitation", schoolId, person.id, pending?.id]),
    queryFn: async () => {
      const invitation = await getMemberInvitation(schoolId, pending!.id);
      if (invitation.person_id !== person.id) throw new Error("This invitation no longer matches this campus person. Close and refresh People before continuing.");
      return invitation;
    },
    enabled: live && Boolean(pending?.id),
    refetchInterval: query => deliveryPending(query.state.data?.delivery) ? 2000
      : query.state.data && invitationState(query.state.data) === "Pending" ? 5000 : false,
  });
  useEffect(() => {
    const accepted = detail.data?.accepted_at;
    if (accepted && acceptedSeen.current !== accepted) { acceptedSeen.current = accepted; changed.current(); }
  }, [detail.data?.accepted_at]);
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!live || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await invitePersonToApp(schoolId, { email: email.trim().toLowerCase(), role: "member", person_id: person.id, idempotency_key: retryKey });
      setPending({ id: result.id, expires_at: result.expires_at, state: "pending" });
      if (result.replayed) setNotice("Invitation already created. It remains pending until the recipient accepts.");
      else { setReady(result); setNotice("Invitation created. App access starts only after the recipient accepts."); }
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The invitation was not confirmed. Your email and retry details are retained."); }
    finally { setBusy(false); }
  }
  async function manage(action: "resend" | "revoke") {
    if (!live || busy || !pending || !detail.data || detail.isError) return;
    setBusy(true); setError(""); setNotice(""); setReady(null);
    try {
      if (action === "resend") setReady(await resendMemberInvitation(schoolId, pending.id));
      else { await revokeMember(schoolId, pending.id); setNotice("Invitation revoked. This person has not been given app access."); }
      await detail.refetch(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This invitation could not be updated. Refresh its current status before trying again."); }
    finally { setBusy(false); }
  }
  const current = detail.data;
  const state = current ? invitationState(current) : pending?.state === "expired" ? "Expired" : "Pending";
  const receipt = ready && current && current.id === ready.id && current.delivery_job_id === ready.delivery_job_id
    ? { ...ready, delivery: current.delivery ?? ready.delivery } : ready;
  const receiptPopup = receipt?.delivery === "email_accepted" || deliveryPending(receipt?.delivery);
  const receiptElement = live && receipt && !receipt.replayed ? <InvitationReceipt invite={receipt} personLabel={person.label} invitationCreated onClose={() => { setReady(null); requestAnimationFrame(() => statusHeading.current?.focus()); }} /> : null;
  const alreadyLinked = person.account_state === "active" || person.account_state === "inactive" || person.has_account || person.is_you;
  const newInvitation = () => { setPending(null); setReady(null); setEmail(""); setRetryKey(crypto.randomUUID()); setNotice(""); setError(""); };
  return <>
    <PlannerDialog title={pending ? "Manage app invitation" : "Invite to app"} subtitle={person.label} onClose={onClose} busy={busy}>
      {!live ? <div className="planner-lesson-form"><p>App access is managed in Live. This simulation cannot invite a real person, send email or change their account.</p><footer><button type="button" onClick={onClose}>Close</button></footer></div>
        : !pending && alreadyLinked ? <div className="planner-lesson-form"><p>{person.account_state === "inactive" ? "This person’s app access is inactive. An invitation cannot reactivate or replace their account." : "This campus person already has an app account. No invitation is needed."}</p><footer><button type="button" onClick={onClose}>Close</button></footer></div>
        : pending ? <div className="planner-lesson-form">
          {detail.isPending ? <p role="status">Loading this person’s invitation…</p> : detail.isError ? <div role="alert"><p>{detail.error.message}</p><button type="button" onClick={() => void detail.refetch()}>Try again</button></div> : current ? <>
            <h3 ref={statusHeading} tabIndex={-1}>{state === "Accepted" ? "App account linked" : state === "Pending" ? "Invitation pending" : `Invitation ${state.toLowerCase()}`}</h3>
            <p>{current.email}</p><p>Expires {new Date(current.expires_at).toLocaleString()}</p>
            {deliveryLabel(current.delivery) ? <p aria-live="polite">{deliveryLabel(current.delivery)}</p> : null}
            {state === "Pending" ? <p>The recipient has not accepted yet. Sending an email does not activate app access.</p> : null}
            {state === "Pending" || state === "Expired" ? <footer><button type="button" disabled={busy || deliveryPending(current.delivery)} onClick={() => void manage("resend")}>{busy ? "Working…" : "Resend invitation email"}</button><button type="button" className="is-secondary" disabled={busy} onClick={() => void manage("revoke")}>Revoke invitation</button></footer> : state === "Revoked" ? <button type="button" onClick={newInvitation}>Create another invitation</button> : null}
          </> : null}
          {notice ? <p role="status">{notice}</p> : null}{error ? <p className="planner-form-error" role="alert">{error}</p> : null}
        </div> : <form className="planner-lesson-form people-editor-form" onSubmit={event => void invite(event)}>
          <p>Give {person.label} app access using this same campus person. This does not create enrollment, assign work or grant operational permissions.</p>
          <fieldset disabled={busy} className="onboarding-fields"><label>Recipient email<input autoFocus type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => { setEmail(event.target.value); setRetryKey(crypto.randomUUID()); setError(""); }} /></label>
            {error ? <p className="planner-form-error" role="alert">{error}</p> : null}
            <footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={!email.trim()}>{busy ? "Creating…" : "Send invitation"}</button></footer>
          </fieldset>
        </form>}
      {!receiptPopup ? receiptElement : null}
    </PlannerDialog>
    {receiptPopup ? receiptElement : null}
  </>;
}
