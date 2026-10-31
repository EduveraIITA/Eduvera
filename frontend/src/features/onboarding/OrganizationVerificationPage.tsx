import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { ProductIcon } from '../../components/ProductIcon';
import { InfoSummary } from '../../components/InfoSummary';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { useAuth } from '../auth/AuthContext';
import { useExecutionEnvironment } from '../simulation/ExecutionEnvironmentContext';
import { submitInstitutionApplication, type InstitutionApplication } from './api';
import { OnboardingFrame } from './OnboardingFrame';
import { getProgressiveWorkspace } from './progressive-api';
import './organisation-verification.css';

const statusLabels = { submitted: 'Under review', needs_information: 'More information requested', approved: 'Verified', rejected: 'Not approved', withdrawn: 'Withdrawn' };
const setupHref = '/more/setup/capabilities';

export default function OrganizationVerificationPage({ presentation = 'onboarding' }: { presentation?: 'onboarding' | 'workspace' } = {}) {
  const auth = useAuth(), environment = useExecutionEnvironment();
  const query = useQuery({ queryKey: ['onboarding', 'progressive', auth.user?.id], queryFn: getProgressiveWorkspace, enabled: environment.mode === 'live' });
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const formHeading = useRef<HTMLHeadingElement>(null), statusHeading = useRef<HTMLHeadingElement>(null), entryAction = useRef<HTMLButtonElement>(null), edited = useRef(false);
  useEffect(() => { if (editing) { edited.current = true; formHeading.current?.focus(); } else if (edited.current) (entryAction.current ?? statusHeading.current)?.focus(); }, [editing]);
  const wrap = (content: ReactNode) => presentation === 'workspace'
    ? <OperationsShell active="more" title="Organization verification" backTo="/more" beforeBack={() => !busy} contentHasHeading><div className="campus-start campus-start--workspace"><div className="campus-start__body organisation-verification">{content}</div></div></OperationsShell>
    : <OnboardingFrame backTo={setupHref} busy={busy}><div className="organisation-verification">{content}</div></OnboardingFrame>;
  if (environment.mode === 'simulation') return wrap(<>
    <VerificationHeader title="Verification belongs to Live" description="This Simulation cannot submit an organisation claim or change verification. Your simulated campus work stays separate." />
    <Link className="campus-start__primary" to="/more/simulation">Open Simulation controls<ArrowRight size={18} aria-hidden="true" /></Link>
    <p className="organisation-verification__note">Return to Live there if you want to review organisation verification.</p>
  </>);
  if (query.isPending) return wrap(<><VerificationHeader /><p role="status">Checking verification status…</p></>);
  if (query.isError) return wrap(<><VerificationHeader /><p className="campus-start__error" role="alert">{query.error.message}</p><button className="campus-start__primary" type="button" onClick={() => void query.refetch()}>Retry</button></>);
  if (!query.data.workspace) return <Navigate to="/onboarding/start" replace />;
  const workspace = query.data.workspace;
  const application = query.data.applications.find(item => item.workspace_school_id === workspace.id || item.provisioned_school_id === workspace.id);
  const approved = workspace.verification_status === 'approved';
  const canStart = !approved && (!application || ['rejected', 'withdrawn'].includes(application.status));
  const needsInformation = !approved && application?.status === 'needs_information';
  const openForm = () => { setError(''); setEditing(true); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || environment.mode !== 'live') return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.declaration_accepted !== 'on') { setError('Confirm that you are authorised to represent this organisation before submitting.'); return; }
    setBusy(true); setError('');
    try {
      await submitInstitutionApplication({ ...values, school_id: workspace.id, application_id: application?.status === 'needs_information' ? application.id : undefined, timezone: workspace.timezone, declaration_accepted: true });
      await query.refetch(); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your request could not be submitted. Your details are still here.'); }
    finally { setBusy(false); }
  }
  return wrap(<>
    <VerificationHeader approved={approved} description={editing ? 'Prepare the official details for your existing campus. All fields are required unless marked optional.' : undefined} />
    {editing && !approved ? <form className="organisation-verification__form" onSubmit={event => void submit(event)} aria-busy={busy}>
      <h2 ref={formHeading} tabIndex={-1}>Organisation details</h2>
      {needsInformation && application.review_note ? <ReviewNote note={application.review_note} /> : null}
      <fieldset className="organisation-verification__fields" disabled={busy}>
        <section className="organisation-verification__section" aria-labelledby="verification-organisation-title">
          <h3 id="verification-organisation-title">Your organisation</h3>
          <label className="campus-start__field">Registered organisation name<input name="institution_name" minLength={2} maxLength={180} required defaultValue={application?.institution_name ?? (workspace.profile_named ? workspace.display_name : '')} autoComplete="organization" /></label>
          <label className="campus-start__field">Organisation type<select name="institution_kind" defaultValue={application?.institution_kind ?? 'school'}><option value="school">School</option><option value="college">College</option><option value="coaching">Coaching or tuition centre</option><option value="hybrid">Educational organisation / group</option></select><small>For this review only. It does not restrict your campus tools.</small></label>
          <div className="organisation-verification__pair"><label className="campus-start__field">State / region code<input name="state_code" defaultValue={application?.state_code ?? ''} minLength={2} maxLength={12} required placeholder="e.g. KA" /></label><label className="campus-start__field">District / locality<input name="district" defaultValue={application?.district ?? ''} minLength={2} maxLength={120} required autoComplete="address-level2" /></label></div>
          <details className="organisation-verification__disclosure"><summary>Website (optional)</summary><label className="campus-start__field">Official website (optional)<input name="website" type="url" defaultValue={application?.website ?? ''} maxLength={240} placeholder="https://" onInvalid={event => { const disclosure = event.currentTarget.closest('details'); if (disclosure) disclosure.open = true; }} /></label></details>
        </section>
        <VerificationEvidence application={application} />
        <section className="organisation-verification__section" aria-labelledby="verification-declaration-title">
          <h3 id="verification-declaration-title">Your declaration</h3>
          <label className="organisation-verification__declaration"><input name="declaration_accepted" type="checkbox" required /><span>I’m authorised to represent this organisation and confirm these details are accurate.</span></label>
        </section>
      </fieldset>
      {error ? <p className="campus-start__error" role="alert">{error}</p> : null}
      <div className="organisation-verification__actions"><button className="campus-start__secondary" type="button" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</button><button className="campus-start__primary" disabled={busy}>{busy ? 'Submitting…' : needsInformation ? 'Resubmit for review' : 'Submit for review'}<ArrowRight size={18} aria-hidden="true" /></button></div>
    </form> : <>
      <section className="organisation-verification__status" aria-labelledby="verification-status-title" data-tone={approved ? 'positive' : application?.status === 'needs_information' || application?.status === 'rejected' ? 'warning' : 'neutral'}>
        <div className="organisation-verification__status-heading"><h2 ref={statusHeading} tabIndex={-1} id="verification-status-title">{approved ? 'Verified' : application ? statusLabels[application.status] : 'Not verified'}</h2>{approved ? <CheckCircle2 size={22} aria-hidden="true" /> : null}</div>
        {application ? <p className="organisation-verification__name">{application.institution_name}</p> : null}
        <p>{approved ? 'The reviewed organisation belongs to the campus you already use.' : application?.status === 'submitted' ? 'Your details are with the review team. Private campus work can continue.' : needsInformation ? 'Review the note below, then update the requested details.' : 'Your private campus work continues. Verify only when you’re ready.'}</p>
        {application?.review_note ? <ReviewNote note={application.review_note} /> : null}
      </section>
      <details className="organisation-verification__disclosure"><InfoSummary>About verification</InfoSummary><p>This is a review of your organisation’s official details. It does not create another workspace, move records or grant operational permissions.</p><p>Use an organisation registration or affiliation reference. Never submit Aadhaar or personal identity numbers.</p></details>
      {canStart || needsInformation ? <><button ref={entryAction} className="campus-start__primary" type="button" onClick={openForm}>{needsInformation ? 'Update requested details' : application ? 'Start a new review' : 'Start verification'}<ArrowRight size={18} aria-hidden="true" /></button><Link className="organisation-verification__later" to={setupHref}>Set up later</Link></> : <Link className="campus-start__primary" to={setupHref}>Continue campus setup<ArrowRight size={18} aria-hidden="true" /></Link>}
    </>}
  </>);
}

function VerificationHeader({ title, description, approved = false }: { title?: string; description?: string; approved?: boolean }) {
  return <header className="organisation-verification__header"><span className="organisation-verification__identity"><ProductIcon name="security" size={28} /></span><h1>{title ?? (approved ? 'Your organisation is verified.' : 'Organisation verification')}</h1><p>{description ?? (approved ? 'Your reviewed details stay with your existing campus.' : 'Optional for private campus work. Submit official details only when you’re ready for review.')}</p></header>;
}
function ReviewNote({ note }: { note: string }) {
  return <div className="organisation-verification__review-note"><h3>Review team note</h3><p>{note}</p></div>;
}
function VerificationEvidence({ application }: { application?: InstitutionApplication }) {
  return <section className="organisation-verification__section" aria-labelledby="verification-evidence-title"><h3 id="verification-evidence-title">Registration reference</h3><p className="organisation-verification__note">Official organisation details only. Never enter Aadhaar or personal identity numbers.</p>
    <label className="campus-start__field">Registration reference type<select name="regulator_type" defaultValue={application?.regulator_type ?? 'other'}><option value="other">Official registration</option><option value="udise">UDISE+</option><option value="aishe">AISHE</option><option value="board_affiliation">Board affiliation</option><option value="trust_registration">Trust / society registration</option></select></label>
    <label className="campus-start__field">Registration or affiliation reference<input name="regulator_reference" defaultValue={application?.regulator_reference ?? ''} minLength={3} maxLength={180} required /><small>Shared only for the ThatCampus organisation review.</small></label>
    <label className="campus-start__field">Your role in the organisation<input name="applicant_role_title" defaultValue={application?.applicant_role_title ?? ''} minLength={2} maxLength={120} required placeholder="e.g. Owner, administrator or trustee" /></label>
  </section>;
}
