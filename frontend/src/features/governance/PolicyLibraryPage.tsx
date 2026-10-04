import { BookOpenCheck, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { acknowledgePolicy, type PublishedPolicy } from "./api";
import "./governance.css";

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
export function PolicyLibraryPage({ portal, schoolId, schoolName, data, refresh }: { portal: "parent" | "student" | "teacher"; schoolId: string; schoolName?: string; data: { policies: PublishedPolicy[]; membership_roles: string[] }; refresh: () => Promise<void> }) {
  const content = <PolicyLibraryContent schoolId={schoolId} policies={data.policies} refresh={refresh} />;
  if (portal === "parent") return <ParentShell active="more" pageLabel="Policies" backTo="/parent/more" institutionLevel>{content}</ParentShell>;
  if (portal === "student") return <StudentShell activeNav="launcher" pageTitle="Policies" backTo="/student/apps" schoolName={schoolName}>{content}</StudentShell>;
  return <OperationsShell portal="teacher" active="more" title="Policies" schoolName={schoolName} backTo="/teacher/more">{content}</OperationsShell>;
}

function PolicyLibraryContent({ schoolId, policies, refresh }: { schoolId: string; policies: PublishedPolicy[]; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  async function acknowledge(policy: PublishedPolicy) { setBusy(policy.id); setError(""); try { await acknowledgePolicy(schoolId, policy.id, `I acknowledge that institution policy version ${policy.version} was presented to me.`); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); } }
  return <div className="policy-library">
    <section className="policy-library__intro"><span><BookOpenCheck size={24} /></span><div><small>INSTITUTION POLICY LIBRARY</small><h1>Published policies</h1><p>Current rules shared with your role. Acknowledgement records the exact version shown—it is not consent or a waiver.</p></div></section>
    {error ? <p className="governance-error" role="alert">{error}</p> : null}
    {policies.length ? <div className="policy-library__list">{policies.map((policy) => <details key={policy.id} className="policy-library__item"><summary><span className="policy-library__icon">{policy.acknowledgement_id ? <CheckCircle2 size={19} /> : <FileCheck2 size={19} />}</span><span><strong>{policy.title}</strong><small>Version {policy.version} · effective {formatDate(policy.effective_on)}</small></span><span className={policy.acknowledgement_id ? "is-acknowledged" : ""}>{policy.acknowledgement_id ? "Acknowledged" : policy.requires_acknowledgement ? "Action needed" : "Read"}</span></summary><div className="policy-library__body"><p className="policy-library__summary">{policy.summary}</p><div className="policy-library__text">{policy.body_markdown}</div>{policy.source_note ? <p className="policy-library__note"><ShieldCheck size={16} /><span><strong>Institution source note</strong>{policy.source_note}</span></p> : null}{policy.review_due_on ? <small>Next institution review: {formatDate(policy.review_due_on)}</small> : null}{policy.requires_acknowledgement && !policy.acknowledgement_id ? <button className="governance-primary" disabled={busy === policy.id} onClick={() => void acknowledge(policy)}>{busy === policy.id ? "Recording…" : "Acknowledge this version"}</button> : policy.acknowledged_at ? <p className="policy-library__confirmed"><CheckCircle2 size={16} />Acknowledged {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(policy.acknowledged_at))}</p> : null}</div></details>)}</div> : <section className="governance-panel governance-empty"><BookOpenCheck size={28} /><h2>No policies published to your role</h2><p>Institution-approved policies will appear here when they are effective.</p></section>}
  </div>;
}
