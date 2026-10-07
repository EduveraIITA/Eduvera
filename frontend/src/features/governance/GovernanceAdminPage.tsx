import { AlertTriangle, BookOpenCheck, Building2, CheckCircle2, ChevronRight, ClipboardCheck, FileClock, History, Landmark, Route, Scale, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { prepareAuthorityDraft, reviewPolicy, savePolicyDraft, submitPolicy, updateRegulatoryProfile, type AuthorityWorkspace, type GovernanceWorkspace, type PolicyFamily } from "./api";
import "./governance.css";

type Tab = "authority" | "register" | "profile" | "history";
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));

export function GovernanceAdminPage({ schoolId, schoolName, data, refresh }: { schoolId: string; schoolName?: string; data: GovernanceWorkspace; refresh: () => Promise<void> }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("section");
  const tab: Tab = requested === "register" || requested === "profile" || requested === "history" ? requested : "authority";
  const setTab = (next: Tab) => setParams(current => { current.set("section", next); return current; });
  const [selected, setSelected] = useState<PolicyFamily | null>(null);
  return <OperationsShell portal="principal" active="more" title="Policies & governance" schoolName={schoolName} backTo="/principal/more">
    <div className="governance-page">
      <section className="governance-summary" aria-label="Governance readiness summary">
        <div><span className="governance-summary__icon"><Scale size={24} /></span><div><small>{label(data.profile.institution_kind)} governance</small><h1>Authority & policies</h1><p>Decision powers, officeholders and adopted rules.</p></div></div>
        <dl><div><dt>Sources</dt><dd>{data.authority.metrics.sources}</dd></div><div><dt>Officeholders</dt><dd>{data.authority.metrics.active_appointments}</dd></div><div><dt>Decision routes</dt><dd>{data.authority.metrics.confirmed_rules}</dd></div><div className={data.authority.metrics.needs_review ? "is-alert" : ""}><dt>Needs review</dt><dd>{data.authority.metrics.needs_review}</dd></div></dl>
      </section>
      <p className="governance-boundary"><ShieldCheck size={18} /><span><strong>Institution review required.</strong> App access does not create decision authority.</span></p>
      <nav className="governance-tabs" aria-label="Governance sections">
        <button className={tab === "authority" ? "is-active" : ""} onClick={() => setTab("authority")}><Landmark size={17} />Authority</button>
        <button className={tab === "register" ? "is-active" : ""} onClick={() => setTab("register")}><BookOpenCheck size={17} />Policy register</button>
        <button className={tab === "profile" ? "is-active" : ""} onClick={() => setTab("profile")}><Building2 size={17} />Institution profile</button>
        <button className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}><History size={17} />History</button>
      </nav>
      {tab === "authority" ? <AuthorityMap schoolId={schoolId} institutionKind={data.profile.institution_kind} data={data.authority} refresh={refresh} /> : tab === "register" ? <PolicyRegister families={data.families} onSelect={setSelected} /> : tab === "profile" ? <ProfileForm schoolId={schoolId} data={data} refresh={refresh} /> : <AuditHistory items={data.audits} />}
      {selected ? <PolicyEditor key={`${selected.id}:${selected.work_revision ?? 0}`} schoolId={schoolId} family={selected} onClose={() => setSelected(null)} onChanged={async () => { await refresh(); setSelected(null); }} /> : null}
    </div>
  </OperationsShell>;
}

function AuthorityMap({ schoolId, institutionKind, data, refresh }: { schoolId: string; institutionKind: string; data: AuthorityWorkspace; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const values = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = values.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    try {
      await prepareAuthorityDraft(schoolId, {
        legal_operator_name: text("legal_operator_name"), lead_officeholder_name: text("lead_officeholder_name"),
        lead_is_current_user: values.has("lead_is_current_user"), authority_basis_title: text("authority_basis_title"),
        authority_reference: text("authority_reference"),
      });
      await refresh();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  if (!data.sources.length) return <section className="governance-panel governance-authority-start">
    <header><div><span className="governance-panel__icon"><Landmark size={20} /></span><div><h2>Set up decision authority</h2><p>The app prepares the structure from four facts.</p></div></div></header>
    <form className="governance-form" onSubmit={(event) => void prepare(event)}>
      <div className="governance-auto-note"><Route size={18} /><span><strong>{label(institutionKind)} starting model</strong> Offices, bodies and routine decision routes will be prepared as a draft.</span></div>
      <div className="governance-form-grid">
        <label>Who operates the institution?<input name="legal_operator_name" required minLength={2} placeholder="Trust, society, company or proprietor" /></label>
        <label>Who leads daily operations?<input name="lead_officeholder_name" required minLength={2} placeholder="Full name" /></label>
        <label>Authority record<input name="authority_basis_title" required minLength={3} placeholder="Trust deed, scheme or owner declaration" /></label>
        <label>Reference <small>Optional for a self-run coaching workspace</small><input name="authority_reference" placeholder="Document number or link" /></label>
      </div>
      <label className="governance-checkbox"><input type="checkbox" name="lead_is_current_user" /> I am the named daily operations lead</label>
      {error ? <p className="governance-error" role="alert">{error}</p> : null}
      <footer><button className="governance-primary" disabled={busy}>{busy ? "Preparing…" : "Prepare authority draft"}</button></footer>
    </form>
  </section>;

  return <div className="governance-authority-grid">
    {data.issues.length ? <section className="governance-review-strip" aria-label="Authority items needing review">
      {data.issues.map((issue) => <div key={issue.code}><span>{issue.count}</span><p>{issue.label}</p></div>)}
    </section> : <p className="governance-authority-ready"><ShieldCheck size={18} /> Current authority map is confirmed.</p>}
    <section className="governance-panel governance-decision-map"><header><div><span className="governance-panel__icon"><Route size={20} /></span><div><h2>Who can decide what?</h2><p>{data.rules.length} recorded routes</p></div></div></header>
      <div className="governance-decision-list">{data.rules.map((rule) => <article key={rule.id}>
        <div><span className={`governance-rule-state governance-rule-state--${rule.status}`}>{rule.status === "confirmed" ? "Confirmed" : "Review"}</span><small>{label(rule.category)}</small></div>
        <h3>{rule.title}</h3><p>{rule.decision_summary}</p>
        <dl><div><dt>Route</dt><dd>{rule.decision_body_title ?? rule.decision_office_title ?? rule.mandate_title ?? label(rule.decision_mode)}</dd></div><div><dt>Then</dt><dd>{rule.execution_summary}</dd></div></dl>
      </article>)}</div>
    </section>
    <section className="governance-authority-columns">
      <div className="governance-panel"><header><div><span className="governance-panel__icon"><UserRoundCheck size={20} /></span><div><h2>Offices</h2><p>Current officeholders</p></div></div><b>{data.offices.length}</b></header><ul className="governance-compact-list">{data.offices.map((office) => <li key={office.id}><span><strong>{office.title}</strong><small>{[office.first_name, office.last_name].filter(Boolean).join(" ") || "Vacant"}</small></span><b className={`governance-state governance-state--${office.appointment_status ?? "missing"}`}>{office.appointment_status ?? "Vacant"}</b></li>)}</ul></div>
      <div className="governance-panel"><header><div><span className="governance-panel__icon"><Landmark size={20} /></span><div><h2>Bodies</h2><p>Collective authorities</p></div></div><b>{data.bodies.length}</b></header><ul className="governance-compact-list">{data.bodies.map((body) => <li key={body.id}><span><strong>{body.title}</strong><small>{body.filled_seats} of {body.seat_count} seats filled</small></span><b>{body.status}</b></li>)}</ul></div>
    </section>
    <section className="governance-source-line"><strong>Authority sources</strong>{data.sources.map((source) => <span key={source.id}><ShieldCheck size={14} />{source.title}<b>{label(source.verification_state)}</b></span>)}</section>
  </div>;
}

function PolicyRegister({ families, onSelect }: { families: PolicyFamily[]; onSelect: (family: PolicyFamily) => void }) {
  const applicable = families.filter((family) => family.applicable);
  const inactive = families.filter((family) => !family.applicable);
  return <>
    <section className="governance-panel governance-register"><header><div><span className="governance-panel__icon"><ClipboardCheck size={20} /></span><div><h2>Applicable policy register</h2><p>Prioritised from the institution profile and enabled capability packs.</p></div></div><b>{applicable.length}</b></header>
      <div className="governance-policy-list">{applicable.map((family) => <button type="button" key={family.id} onClick={() => onSelect(family)}>
        <span className={`governance-risk governance-risk--${family.risk_level}`}>{family.risk_level === "high" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}</span>
        <span><strong>{family.title}</strong><small>{label(family.category)} · {family.guidance}</small></span>
        <span className={`governance-state governance-state--${family.work_status ?? family.current_status ?? "missing"}`}>{family.work_status === "in_review" ? "Review" : family.work_status === "draft" ? `Draft v${family.work_version}` : family.current_status === "published" ? `Published v${family.current_version}` : "Not started"}</span><ChevronRight size={18} />
      </button>)}</div>
    </section>
    {inactive.length ? <details className="governance-secondary-list"><summary>{inactive.length} policies not applicable to this profile</summary><div>{inactive.map((family) => <span key={family.id}>{family.title}</span>)}</div></details> : null}
  </>;
}

function ProfileForm({ schoolId, data, refresh }: { schoolId: string; data: GovernanceWorkspace; refresh: () => Promise<void> }) {
  const profile = data.profile;
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false); const values = new FormData(event.currentTarget);
    const text = (name: string) => { const value = values.get(name); return typeof value === "string" ? value : ""; };
    const list = (name: string) => text(name).split(",").map((item) => item.trim()).filter(Boolean);
    try {
      await updateRegulatoryProfile(schoolId, {
        institution_kind: text("institution_kind"), country_code: text("country_code"), state_code: text("state_code"), district: text("district"),
        management_kind: text("management_kind"), delivery_mode: text("delivery_mode"), education_levels: list("education_levels"), regulator_codes: list("regulator_codes"), capability_packs: profile.capability_packs,
        recognition_reference: text("recognition_reference"), affiliation_reference: text("affiliation_reference"), residential: values.has("residential"), transport_provided: values.has("transport_provided"), minors_enrolled: values.has("minors_enrolled"),
        staff_count_band: text("staff_count_band"), reviewed_on: text("reviewed_on") || null, review_note: text("review_note"), expected_revision: profile.revision,
      }); await refresh(); setSaved(true);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <section className="governance-panel"><header><div><span className="governance-panel__icon"><Building2 size={20} /></span><div><h2>Institution regulatory profile</h2><p>Drives applicability. It is not an affiliation or recognition certificate.</p></div></div><b>Revision {profile.revision}</b></header>
    <form className="governance-form" onSubmit={(event) => void submit(event)}>
      <div className="governance-form-grid">
        <label>Institution type<select name="institution_kind" defaultValue={profile.institution_kind}><option value="school">School</option><option value="college">College</option><option value="coaching">Coaching institution</option><option value="hybrid">Hybrid institution</option></select></label>
        <label>Management<select name="management_kind" defaultValue={profile.management_kind}><option value="government">Government</option><option value="government_aided">Government aided</option><option value="private_unaided">Private unaided</option><option value="trust_society">Trust / society</option><option value="corporate">Corporate</option><option value="other">Other</option></select></label>
        <label>Country code<input name="country_code" defaultValue={profile.country_code} maxLength={2} required /></label><label>State / UT code<input name="state_code" defaultValue={profile.state_code} placeholder="KA" /></label>
        <label>District<input name="district" defaultValue={profile.district} /></label><label>Delivery mode<select name="delivery_mode" defaultValue={profile.delivery_mode}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
        <label className="governance-span">Education levels <small>Comma separated, for example primary, secondary, senior_secondary</small><input name="education_levels" defaultValue={profile.education_levels.join(", ")} required /></label>
        <label className="governance-span">Board, regulator or university codes <small>Comma separated, for example CBSE</small><input name="regulator_codes" defaultValue={profile.regulator_codes.join(", ")} /></label>
        <label>Recognition reference<input name="recognition_reference" defaultValue={profile.recognition_reference} /></label><label>Affiliation reference<input name="affiliation_reference" defaultValue={profile.affiliation_reference} /></label>
        <label>Staff count<select name="staff_count_band" defaultValue={profile.staff_count_band}><option value="0_9">0–9</option><option value="10_49">10–49</option><option value="50_99">50–99</option><option value="100_249">100–249</option><option value="250_plus">250+</option></select></label><label>Profile reviewed on<input name="reviewed_on" type="date" defaultValue={profile.reviewed_on ?? ""} /></label>
        <fieldset className="governance-checks governance-span"><legend>Operational scope</legend><label><input type="checkbox" name="minors_enrolled" defaultChecked={profile.minors_enrolled} /> Minors enrolled</label><label><input type="checkbox" name="residential" defaultChecked={profile.residential} /> Residential</label><label><input type="checkbox" name="transport_provided" defaultChecked={profile.transport_provided} /> Transport provided</label></fieldset>
        <label className="governance-span">Review note<textarea name="review_note" defaultValue={profile.review_note} rows={3} placeholder="Who verified this profile and against which institution records?" /></label>
      </div>{error ? <p className="governance-error" role="alert">{error}</p> : null}{saved ? <p className="governance-success" role="status">Profile saved and applicability recalculated.</p> : null}<footer><button className="governance-primary" disabled={busy}>{busy ? "Saving…" : "Save reviewed profile"}</button></footer>
    </form>
  </section>;
}

function PolicyEditor({ schoolId, family, onClose, onChanged }: { schoolId: string; family: PolicyFamily; onClose: () => void; onChanged: () => Promise<void> }) {
  const dialog = useRef<HTMLElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [reviewNote, setReviewNote] = useState(""); const [override, setOverride] = useState("");
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; heading.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", key); return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", key); }; }, [busy, onClose]);
  const isReview = family.work_status === "in_review";
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const values = new FormData(event.currentTarget); const audiences = ["admin", "staff", "guardian", "student"].filter((role) => values.has(`audience_${role}`));
    try { await savePolicyDraft(schoolId, family.code, { title: values.get("title"), summary: values.get("summary"), body_markdown: values.get("body_markdown"), audience_roles: audiences, requires_acknowledgement: values.has("requires_acknowledgement"), effective_on: values.get("effective_on") || null, review_due_on: values.get("review_due_on") || null, source_note: values.get("source_note"), ...(family.work_revision ? { expected_revision: family.work_revision } : {}) }); await onChanged(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function command(kind: "submit" | "publish" | "reject") { if (!family.work_version_id || !family.work_revision) return; setBusy(true); setError(""); try { if (kind === "submit") await submitPolicy(schoolId, family.work_version_id, family.work_revision); else await reviewPolicy(schoolId, family.work_version_id, { decision: kind, expected_revision: family.work_revision, note: reviewNote, override_reason: override }); await onChanged(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  const audiences = family.work_audience_roles ?? family.default_audiences;
  return <div className="governance-modal" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="policy-editor-title">
    <header><div><span>{family.risk_level === "high" ? "HIGH-RISK POLICY" : "POLICY WORKSPACE"}</span><h2 id="policy-editor-title" ref={heading} tabIndex={-1}>{family.title}</h2><p>{family.guidance}</p></div><button type="button" aria-label="Close policy editor" onClick={onClose} disabled={busy}><X size={21} /></button></header>
    {isReview ? <div className="governance-review"><p><FileClock size={18} /><span><strong>Version {family.work_version} is ready for review.</strong> Confirm scope, dates, audiences and source note before publishing.</span></p><label>Review note<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={3} placeholder="Record what was checked and any limitations." /></label><label>Independent review override <small>Leave blank when another administrator is reviewing. If you submitted this version and no independent reviewer is available, explain why.</small><textarea value={override} onChange={(event) => setOverride(event.target.value)} rows={2} placeholder="Required only for same-administrator publication." /></label><footer><button className="governance-secondary governance-danger" disabled={busy || reviewNote.trim().length < 5} onClick={() => void command("reject")}>Return to draft</button><button className="governance-primary" disabled={busy || reviewNote.trim().length < 5} onClick={() => void command("publish")}>Publish reviewed version</button></footer></div> : <form className="governance-form" onSubmit={(event) => void save(event)}><label>Title<input name="title" required minLength={3} defaultValue={family.work_title ?? family.title} /></label><label>Plain-language summary<textarea name="summary" required minLength={12} maxLength={600} rows={3} defaultValue={family.work_summary ?? family.current_summary ?? ""} /></label><label>Policy text<textarea name="body_markdown" required minLength={40} rows={12} defaultValue={family.work_body_markdown ?? ""} placeholder="Write the institution-approved policy, responsibilities, channels, escalation and review process." /></label><fieldset className="governance-checks"><legend>Published to</legend>{["admin", "staff", "guardian", "student"].map((role) => <label key={role}><input type="checkbox" name={`audience_${role}`} defaultChecked={audiences.includes(role)} /> {label(role)}</label>)}</fieldset><div className="governance-form-grid"><label>Effective on<input name="effective_on" type="date" defaultValue={family.work_effective_on ?? family.current_effective_on ?? new Date().toISOString().slice(0, 10)} /></label><label>Review due<input name="review_due_on" type="date" defaultValue={family.work_review_due_on ?? ""} /></label></div><label>Source and review note<textarea name="source_note" rows={3} defaultValue={family.work_source_note ?? ""} placeholder="Local circulars, board rules, legal review or school committee decision." /></label><label className="governance-checkbox"><input type="checkbox" name="requires_acknowledgement" defaultChecked={family.work_requires_acknowledgement ?? family.default_requires_acknowledgement} /> Require each audience member to acknowledge this exact version</label>{family.source_references?.length ? <div className="governance-sources"><strong>Official-source prompts</strong>{family.source_references.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}</div> : null}<footer><button className="governance-secondary" type="button" onClick={onClose}>Cancel</button><button className="governance-primary" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button></footer></form>}
    {family.work_status === "draft" ? <div className="governance-submit"><span>Draft v{family.work_version} · revision {family.work_revision}</span><button className="governance-primary" disabled={busy} onClick={() => void command("submit")}>Submit for review</button></div> : null}{error ? <p className="governance-error" role="alert">{error}</p> : null}
  </section></div>;
}

function AuditHistory({ items }: { items: GovernanceWorkspace["audits"] }) {
  return <section className="governance-panel"><header><div><span className="governance-panel__icon"><History size={20} /></span><div><h2>Governance history</h2><p>Profile, review, publication and acknowledgement evidence.</p></div></div><b>{items.length}</b></header>{items.length ? <ol className="governance-audit">{items.map((item) => <li key={item.id}><span><History size={15} /></span><div><strong>{label(item.action.replace("governance.", ""))}</strong><small>{item.first_name} {item.last_name} · {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}</small></div>{typeof item.metadata.version === "number" ? <b>v{item.metadata.version}</b> : null}</li>)}</ol> : <p className="governance-empty">No governance activity recorded yet.</p>}</section>;
}

export { formatDate };
