import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Clock3, GraduationCap, LoaderCircle, LogOut, ShieldCheck, UsersRound } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { SchoolBrand } from "../school/SchoolBrand";
import { createCoachingWorkspace, getOnboardingWorkspace, submitInstitutionApplication, type InstitutionApplication } from "./api";
import "./onboarding.css";
import "./self-service.css";

type Mode = "choose" | "institution" | "coaching";

function codeFromName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
}

function StatusBadge({ status }: { status: InstitutionApplication["status"] }) {
  const labels = { submitted: "Under review", needs_information: "Information needed", approved: "Approved", rejected: "Not approved", withdrawn: "Withdrawn" };
  return <span className={`self-status self-status--${status}`}>{status === "submitted" ? <Clock3 size={14} /> : status === "approved" ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}{labels[status]}</span>;
}

export default function SelfServiceOnboardingPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const workspace = useQuery({ queryKey: ["onboarding", "workspace"], queryFn: getOnboardingWorkspace });
  const [mode, setMode] = useState<Mode>("choose");
  const [editing, setEditing] = useState<InstitutionApplication | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (auth.companyOperator) return <Navigate to="/company" replace/>;

  function select(next: Mode) {
    setMode(next); setError(""); setEditing(null); setName(""); setCode(""); setCodeEdited(false);
  }
  function changeName(value: string) { setName(value); if (!codeEdited) setCode(codeFromName(value)); }
  function editApplication(application: InstitutionApplication) {
    setEditing(application); setMode("institution"); setName(application.institution_name); setCode(application.requested_code); setCodeEdited(true); setError("");
  }
  async function submitFormal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const requestedCode = typeof data.requested_code === "string" ? data.requested_code : "";
    try {
      await submitInstitutionApplication({ ...data, application_id: editing?.id, requested_code: codeFromName(requestedCode), declaration_accepted: data.declaration_accepted === "on" });
      await workspace.refetch(); setMode("choose"); setEditing(null);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function submitCoaching(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const workspaceCode = typeof data.code === "string" ? data.code : "";
    try {
      await createCoachingWorkspace({ ...data, code: codeFromName(workspaceCode), minors_enrolled: data.minors_enrolled === "on" });
      await auth.refresh(); void navigate("/principal/administration", { replace: true });
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  return <main className="self-onboarding">
    <header className="self-onboarding__top">
      <SchoolBrand name="Eduvera" marksLayout="side-by-side" />
      <div><span>{auth.user?.display_name}</span><button type="button" onClick={() => void auth.logout()}><LogOut size={16}/>Sign out</button></div>
    </header>
    <section className="self-onboarding__shell">
      <header className="self-onboarding__intro">
        <span className="self-onboarding__eyebrow">Set up your workspace</span>
        <h1>{mode === "choose" ? "How would you like to begin?" : mode === "institution" ? "Onboard your institution" : "Create your coaching workspace"}</h1>
        <p>{mode === "choose" ? "Choose the path that matches how your organisation operates today. You can add people after the workspace is ready." : mode === "institution" ? "Schools and colleges are reviewed by Eduvera before their workspace is activated." : "For an independent tutor or small coaching group. No company verification is required."}</p>
      </header>

      {workspace.isError ? <div className="self-onboarding__alert" role="alert">{workspace.error.message}<button type="button" onClick={() => void workspace.refetch()}>Retry</button></div> : null}
      {error ? <div className="self-onboarding__alert" role="alert"><ShieldCheck size={18}/>{error}</div> : null}

      {mode === "choose" ? <>
        {workspace.isPending ? <div className="self-onboarding__loading" role="status"><LoaderCircle className="auth-spin"/>Loading your onboarding status…</div> : null}
        {workspace.data?.applications.length ? <section className="application-statuses" aria-labelledby="application-status-title">
          <div className="application-statuses__heading"><div><span>Your applications</span><h2 id="application-status-title">Institution review status</h2></div></div>
          {workspace.data.applications.map((application) => <article key={application.id} className="application-status-card">
            <div><Building2 size={20}/><div><strong>{application.institution_name}</strong><small>{application.institution_kind} · {application.requested_code}</small></div></div>
            <StatusBadge status={application.status}/>
            {application.review_note ? <p><b>Review note:</b> {application.review_note}</p> : application.status === "submitted" ? <p>Eduvera will review the organisation details. Your account remains private while the review is open.</p> : null}
            {application.status === "needs_information" ? <button type="button" className="self-secondary" onClick={() => editApplication(application)}>Update and resubmit <ArrowRight size={16}/></button> : null}
            {application.status === "approved" ? <button type="button" className="self-primary" onClick={async () => { await auth.refresh(); void navigate("/", { replace: true }); }}>Open institution workspace <ArrowRight size={16}/></button> : null}
          </article>)}
        </section> : null}
        <section className="onboarding-models" aria-label="Workspace onboarding options">
          <article className="onboarding-model onboarding-model--verified">
            <div className="onboarding-model__icon"><Building2/></div><span className="onboarding-model__tag"><ShieldCheck size={14}/>Company verified</span>
            <h2>Onboard your institution</h2><p>For a school, college, trust, or organised education institution that needs a verified workspace.</p>
            <ul><li><Check/>Submit registration or affiliation details</li><li><Check/>Eduvera reviews the application</li><li><Check/>Workspace opens after approval</li></ul>
            <button type="button" className="self-primary" onClick={() => select("institution")}>Start institution application <ArrowRight size={17}/></button>
          </article>
          <article className="onboarding-model onboarding-model--coaching">
            <div className="onboarding-model__icon"><GraduationCap/></div><span className="onboarding-model__tag"><Clock3 size={14}/>Ready immediately</span>
            <h2>Create your coaching workspace</h2><p>For an independent tutor or a small coaching group managing a focused learner community.</p>
            <ul><li><Check/>No Eduvera verification</li><li><Check/>Invite students after setup</li><li><Check/>Start with a lightweight capability pack</li></ul>
            <button type="button" className="self-primary" onClick={() => select("coaching")}>Create coaching workspace <ArrowRight size={17}/></button>
          </article>
        </section>
        <p className="existing-institution"><UsersRound size={17}/>Joining an existing institution? <Link to="/join">Use your invitation code</Link></p>
      </> : null}

      {mode === "institution" ? <form className="self-form" onSubmit={(event) => void submitFormal(event)}>
        <button type="button" className="self-back" onClick={() => select("choose")}><ArrowLeft size={16}/>Back to options</button>
        {editing ? <div className="self-form__notice"><ShieldCheck size={18}/><div><b>Update requested information</b><p>{editing.review_note}</p></div></div> : null}
        <section><header><span>1</span><div><h2>Institution details</h2><p>Use the legal or commonly registered name.</p></div></header><div className="self-form__grid">
          <label>Institution name<input name="institution_name" value={name} onChange={(event) => changeName(event.target.value)} minLength={2} maxLength={180} required/></label>
          <label>Institution type<select name="institution_kind" defaultValue={editing?.institution_kind ?? "school"}><option value="school">School</option><option value="college">College</option><option value="hybrid">School and college group</option></select></label>
          <label>Workspace code<input name="requested_code" value={code} onChange={(event) => { setCodeEdited(true); setCode(event.target.value); }} onBlur={() => setCode(codeFromName(code))} minLength={2} maxLength={32} required/><small>Used in secure workspace links. Lowercase letters, numbers and hyphens only.</small></label>
          <label>Timezone<input name="timezone" defaultValue={editing?.timezone ?? "Asia/Kolkata"} maxLength={64} required/></label>
          <label>State or UT code<input name="state_code" defaultValue={editing?.state_code ?? ""} placeholder="e.g. KA" minLength={2} maxLength={12} required/></label>
          <label>District<input name="district" defaultValue={editing?.district ?? ""} minLength={2} maxLength={120} required/></label>
          <label className="self-form__wide">Official website <span>(optional)</span><input type="url" name="website" defaultValue={editing?.website ?? ""} placeholder="https://…" maxLength={240}/></label>
        </div></section>
        <section><header><span>2</span><div><h2>Verification details</h2><p>These details are visible only to the Eduvera review team.</p></div></header><div className="self-form__grid">
          <label>Your role at the institution<input name="applicant_role_title" defaultValue={editing?.applicant_role_title ?? ""} placeholder="e.g. Principal, trustee, centre head" minLength={2} maxLength={120} required/></label>
          <label>Reference type<select name="regulator_type" defaultValue={editing?.regulator_type ?? "udise"}><option value="udise">UDISE+</option><option value="aishe">AISHE</option><option value="board_affiliation">Board affiliation</option><option value="trust_registration">Trust / society registration</option><option value="other">Other official registration</option></select></label>
          <label className="self-form__wide">Registration or affiliation reference<input name="regulator_reference" defaultValue={editing?.regulator_reference ?? ""} minLength={3} maxLength={180} required/><small>Do not enter Aadhaar or personal identity numbers.</small></label>
        </div></section>
        <label className="self-declaration"><input type="checkbox" name="declaration_accepted" required/><span>I am authorised to request this workspace and confirm that the organisation details are accurate.</span></label>
        <button className="self-primary self-form__submit" disabled={busy}>{busy ? <><LoaderCircle className="auth-spin" size={17}/>Submitting…</> : <>{editing ? "Resubmit for review" : "Submit for company review"}<ArrowRight size={17}/></>}</button>
      </form> : null}

      {mode === "coaching" ? <form className="self-form self-form--coaching" onSubmit={(event) => void submitCoaching(event)}>
        <button type="button" className="self-back" onClick={() => select("choose")}><ArrowLeft size={16}/>Back to options</button>
        <div className="coaching-boundary"><GraduationCap/><div><b>A coaching workspace is not a verified school or college.</b><p>It starts with coaching-appropriate capabilities. You can request formal institution verification later if your organisation grows.</p></div></div>
        <section><header><span>1</span><div><h2>Workspace details</h2><p>You can invite learners and staff after creation.</p></div></header><div className="self-form__grid">
          <label>Coaching or tutor name<input name="name" value={name} onChange={(event) => changeName(event.target.value)} minLength={2} maxLength={180} required/></label>
          <label>Workspace code<input name="code" value={code} onChange={(event) => { setCodeEdited(true); setCode(event.target.value); }} onBlur={() => setCode(codeFromName(code))} minLength={2} maxLength={32} required/></label>
          <label>Teaching mode<select name="delivery_mode"><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
          <label>Timezone<input name="timezone" defaultValue="Asia/Kolkata" maxLength={64} required/></label>
        </div></section>
        <label className="self-declaration"><input type="checkbox" name="minors_enrolled" defaultChecked/><span>This workspace teaches learners under 18. Keep age-appropriate safeguards enabled.</span></label>
        <button className="self-primary self-form__submit" disabled={busy}>{busy ? <><LoaderCircle className="auth-spin" size={17}/>Creating…</> : <>Create workspace now <ArrowRight size={17}/></>}</button>
      </form> : null}
    </section>
  </main>;
}
