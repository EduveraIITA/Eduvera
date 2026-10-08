import { BookOpenCheck, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { acknowledgePolicy, type PublishedPolicy } from "./api";
import "./governance.css";

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
export function PolicyLibraryPage({ portal, schoolId, schoolName, data, refresh }: { portal: "parent" | "student" | "teacher"; schoolId: string; schoolName?: string; data: { policies: PublishedPolicy[]; membership_roles: string[] }; refresh: () => Promise<void> }) {
  const [params] = useSearchParams();
  const selected=params.get("policy");
  const context=new URLSearchParams(params);context.delete("policy");
  const backTo=selected?`/${portal}/policies${context.size?`?${context}`:""}`:`/${portal}/${portal==="student"?"apps":"more"}`;
  const content = <PolicyLibraryContent schoolId={schoolId} policies={data.policies} refresh={refresh} />;
  const title=selected?"Policy details":"Policies";
  if (portal === "parent") return <ParentShell active="more" pageLabel={title} backTo={backTo} institutionLevel>{content}</ParentShell>;
  if (portal === "student") return <StudentShell activeNav="launcher" pageTitle={title} backTo={backTo} schoolName={schoolName}>{content}</StudentShell>;
  return <OperationsShell portal="teacher" active="more" title={title} schoolName={schoolName} backTo={backTo}>{content}</OperationsShell>;
}

function PolicyLibraryContent({ schoolId, policies, refresh }: { schoolId: string; policies: PublishedPolicy[]; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [params]=useSearchParams(); const selected=params.get("policy");
  const visible=selected?policies.filter(policy=>policy.id===selected):policies;
  const href=(id:string)=>{const next=new URLSearchParams(params);next.set("policy",id);return `?${next}`;};
  async function acknowledge(policy: PublishedPolicy) { setBusy(policy.id); setError(""); try { await acknowledgePolicy(schoolId, policy.id, `I acknowledge that institution policy version ${policy.version} was presented to me.`); await refresh(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); } }
  return <div className="policy-library">
    <p className="policy-library__intro">Acknowledgement records the version you have read. It is not consent or a waiver.</p>
    {error ? <p className="governance-error" role="alert">{error}</p> : null}
    {visible.length ? <div className="policy-library__list">{visible.map((policy) => <article key={policy.id} className="policy-library__item">{!selected?<Link to={href(policy.id)}><span className="policy-library__icon">{policy.acknowledgement_id ? <CheckCircle2 size={19} /> : <FileCheck2 size={19} />}</span><span><strong>{policy.title}</strong><small>Version {policy.version} · effective {formatDate(policy.effective_on)}</small></span><span className={policy.acknowledgement_id ? "is-acknowledged" : ""}>{policy.acknowledgement_id ? "Acknowledged" : policy.requires_acknowledgement ? "Action needed" : "Read"}</span></Link>:<div className="policy-library__body"><h2>{policy.title}</h2><p>Version {policy.version} · effective {formatDate(policy.effective_on)}</p><p className="policy-library__summary">{policy.summary}</p><div className="policy-library__text">{policy.body_markdown}</div>{policy.source_note ? <p className="policy-library__note"><ShieldCheck size={16} /><span><strong>Institution source note</strong>{policy.source_note}</span></p> : null}{policy.review_due_on ? <small>Next institution review: {formatDate(policy.review_due_on)}</small> : null}{policy.requires_acknowledgement && !policy.acknowledgement_id ? <button className="governance-primary" disabled={busy === policy.id} onClick={() => void acknowledge(policy)}>{busy === policy.id ? "Recording…" : "Acknowledge this version"}</button> : policy.acknowledged_at ? <p className="policy-library__confirmed"><CheckCircle2 size={16} />Acknowledged {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(policy.acknowledged_at))}</p> : null}</div>}</article>)}</div> : <section className="governance-panel governance-empty"><BookOpenCheck size={28} /><h2>{selected?"Policy not available":"No policies published to your role"}</h2><p>{selected?"This policy may no longer be published to your role. Return to the policy list.":"Institution-approved policies will appear here when they are effective."}</p></section>}
  </div>;
}
