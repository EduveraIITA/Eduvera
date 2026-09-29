import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarX2, CheckCircle2, FileText, Info, ShieldCheck, Stethoscope, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { staffApi, type LeaveRequest } from "../features/staff";
import { Empty, IconSq, Initials, PageTitle, Pill, SectionTitle, Skeleton, Stat, Status, Tabs, fmtDate, leaveLabel, leaveTone, plain, useToast } from "../components/ui";

const TABS: Array<{ id: string; label: string; status?: string }> = [
  { id: "authorized", label: "Awaiting decision", status: "authorized" },
  { id: "pending_guardian", label: "Awaiting guardian", status: "pending_guardian" },
  { id: "school_approved", label: "Approved", status: "school_approved" },
  { id: "school_rejected", label: "Rejected", status: "school_rejected" },
  { id: "all", label: "All" },
];

const who = (l: LeaveRequest) => l.student?.display_name ?? l.student?.name ?? l.student_name ?? l.requested_by_name;
const cls = (l: LeaveRequest) => l.class_name ?? l.student?.class_name ?? null;
const span = (l: LeaveRequest) => `${fmtDate(l.starts_on, { weekday: "short", day: "numeric", month: "short" })}${l.ends_on && l.ends_on !== l.starts_on ? ` – ${fmtDate(l.ends_on, { weekday: "short", day: "numeric", month: "short" })}` : ""}`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/* Leave is a decision queue. Every decision is attributed to the person who made it. */
export function LeavePage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === (params.get("tab") ?? "authorized")) ?? TABS[0]!;
  const focus = params.get("focus");
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState<Record<string, string>>({});
  const focusRef = useRef<HTMLDivElement>(null);

  const list = useQuery({ queryKey: ["leaves", tab.status ?? "all"], queryFn: () => staffApi.leaves(tab.status) });
  const all = useQuery({ queryKey: ["leaves", "all"], queryFn: () => staffApi.leaves(), staleTime: 30_000 });
  useEffect(() => { if (focus && list.data) focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus, list.data]);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => staffApi.leaveAction(id, action, note[id]?.trim() || undefined),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["leaves"] });
      void qc.invalidateQueries({ queryKey: ["principal-home"] });
      setParams((p) => { p.delete("focus"); return p; });
      toast(v.action === "approve" ? "Leave approved. The family has been notified." : "Leave rejected. The family has been notified.");
    },
    onError: (e: Error) => toast(e.message, true),
  });

  const rows = list.data?.results ?? [];
  const everything = all.data?.results ?? [];
  const count = (s: string) => everything.filter((l) => l.status === s).length;
  const waiting = count("authorized");
  const thisMonth = everything.filter((l) => l.decided_at && new Date(l.decided_at).getMonth() === new Date().getMonth());
  const away = everything.filter((l) => l.status === "school_approved" && l.starts_on <= new Date().toISOString().slice(0, 10) && (l.ends_on ?? l.starts_on) >= new Date().toISOString().slice(0, 10));

  return (
    <>
      <PageTitle icon={CalendarX2} eyebrow={<>Leave requests<span className="sep" />{everything.length} this term</>}
        title={waiting ? `${waiting} request${waiting === 1 ? "" : "s"} awaiting your decision` : "Decision queue is clear"}
        sub="Each request here already carries a guardian's authorisation. Approvals and rejections are recorded against your name and notify the family."
        actions={<Tabs value={tab.id} onChange={(id) => setParams((p) => { p.set("tab", id); p.delete("focus"); return p; })} items={TABS.map((t) => ({ id: t.id, label: t.label, count: t.status && t.status !== "school_approved" ? count(t.status) : undefined }))} />} />

      <div className="grid4">
        <Stat label="Awaiting decision" icon={ShieldCheck} value={waiting} tone={waiting ? "cau" : "pos"} note={waiting ? "ready to decide" : "nothing pending"} />
        <Stat label="Awaiting guardian" icon={Info} iconKind="high" value={count("pending_guardian")} note="not yet authorised at home" />
        <Stat label="Away today" icon={CalendarX2} iconKind="sec" value={away.length} note={away.length ? [...new Set(away.map(cls).filter(Boolean))].slice(0, 3).join(", ") : "no approved leave today"} />
        <Stat label="Decided this month" icon={CheckCircle2} value={thisMonth.length} tone="inf" note={`${thisMonth.filter((l) => l.status === "school_approved").length} approved · ${thisMonth.filter((l) => l.status === "school_rejected").length} rejected`} />
      </div>

      <div className="grid12">
        <div className="col-8 col sm">
          {list.isPending ? <Skeleton h={260} /> : rows.length === 0 ? <div className="card"><Empty>{tab.id === "authorized" ? "Nothing is waiting for a decision." : "Nothing in this list."}</Empty></div> : rows.map((l) => {
            const decidable = l.status === "authorized";
            const isFocus = focus === l.id;
            const medical = l.category === "medical";
            return (
              <div key={l.id} ref={isFocus ? focusRef : undefined} className={`card${isFocus ? " ring" : ""}`} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
                    <Initials name={who(l)} src={l.student?.avatar_url} size={44} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h3 className="t-hlg">{who(l)}</h3>
                        {cls(l) ? <Pill>{cls(l)}</Pill> : null}
                        <Status tone={leaveTone(l.status)}>{leaveLabel(l.status)}</Status>
                      </div>
                      <p className="t-bsm ink2" style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: medical ? "var(--cri)" : "var(--brand-text)", fontWeight: 600 }}>{medical ? <Stethoscope size={14} /> : <FileText size={14} />}{l.category_label ?? plain(l.category)} leave</span>
                        <span>·</span><span>{span(l)}</span><span>·</span><span>{days(l.duration_days)}</span>
                        {l.student?.admission_number ? <><span>·</span><span className="mono">{l.student.admission_number}</span></> : null}
                      </p>
                    </div>
                  </div>
                  <span className="lbl">REQ-{l.id.slice(0, 8).toUpperCase()}</span>
                </div>

                <div className="grid3">
                  <div className="tile md"><span className="lbl">Requested by</span><span className="t-llg">{l.requested_by_name}</span>{l.submitted_at ? <span className="t-bsm ink2">{fmtDate(l.submitted_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}</div>
                  <div className="tile md"><span className="lbl">Guardian sign-off</span><span className="t-llg">{l.guardian_authorized_by_name ?? "Pending"}</span>{l.guardian_authorized_at ? <span className="t-bsm ink2">{fmtDate(l.guardian_authorized_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : <span className="t-bsm ink2">{l.status === "pending_guardian" ? "waiting at home" : "—"}</span>}</div>
                  <div className={`tile md${l.status === "school_approved" ? " pos" : l.status === "school_rejected" ? " cri" : ""}`}><span className="lbl">School decision</span><span className="t-llg">{l.decided_by_name ?? "Pending"}</span>{l.decided_at ? <span className="t-bsm ink2">{fmtDate(l.decided_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : <span className="t-bsm ink2">{decidable ? "yours to make" : "not yet"}</span>}</div>
                </div>

                {l.reason ? <div className="quote">“{l.reason}”</div> : null}
                {l.documents.length ? <div className="btnrow">{l.documents.map((doc, i) => <a key={doc.id} className="btn sm outline" href={doc.file_url} target="_blank" rel="noreferrer"><FileText size={14} />Document {i + 1} · {(doc.size_bytes / 1024).toFixed(0)} KB</a>)}</div>
                  : medical && l.duration_days > 2 ? <div className="callout cau" style={{ padding: 12 }}><Info size={18} color="var(--cau-ink)" style={{ flexShrink: 0, marginTop: 1 }} /><span className="t-bsm ink2">Medical leave of {days(l.duration_days)} with no clinic note attached.</span></div> : null}

                {decidable ? (
                  <div className="col sm" style={{ paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                    <span className="lbl">Your decision</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <input className="input" placeholder="Note to the family (optional, shown with the decision)" value={note[l.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [l.id]: e.target.value }))} style={{ flex: "1 1 260px" }} />
                      <button className="btn pri" disabled={act.isPending} onClick={() => act.mutate({ id: l.id, action: "approve" })}><CheckCircle2 size={18} />Approve</button>
                      <button className="btn danger" disabled={act.isPending} onClick={() => act.mutate({ id: l.id, action: "reject" })}><XCircle size={18} />Reject</button>
                    </div>
                  </div>
                ) : null}

                {l.audit_log?.length ? (
                  <details className="t-bsm ink2" open={isFocus}>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>History · {l.audit_log.length}</summary>
                    <div className="col" style={{ gap: 4, marginTop: 8 }}>
                      {l.audit_log.map((a) => <div key={a.id}>{fmtDate(a.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {a.actor_name}{a.to_status ? ` · ${leaveLabel(a.to_status)}` : ""}{a.note ? ` — ${a.note}` : ""}</div>)}
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="col-4 col sm">
          <div className="panel tight">
            <SectionTitle small icon={ShieldCheck} title="Up next" />
            {waiting ? (
              <div className="col xs">
                {everything.filter((l) => l.status === "authorized").slice(0, 6).map((l) => (
                  <button key={l.id} className="tile md hov row-tile" style={{ alignItems: "center", width: "100%" }} onClick={() => setParams((p) => { p.set("tab", "authorized"); p.set("focus", l.id); return p; })}>
                    <IconSq icon={l.category === "medical" ? Stethoscope : FileText} kind={l.category === "medical" ? "cri" : "tint"} />
                    <div className="rowtxt"><b>{who(l)}</b><span>{cls(l) ? `${cls(l)} · ` : ""}{l.category_label ?? plain(l.category)} · {days(l.duration_days)} from {fmtDate(l.starts_on, { day: "numeric", month: "short" })}</span></div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="callout pos"><ShieldCheck size={20} color="var(--pos)" style={{ flexShrink: 0, marginTop: 2 }} /><div><div className="t-lmd">Queue is clear</div><p className="t-bsm ink2" style={{ marginTop: 2 }}>Every authorised request has a decision.</p></div></div>
            )}
          </div>
          <div className="panel tight">
            <SectionTitle small icon={Info} title="Protocol" />
            <details className="t-bsm ink2" open><summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>Approve or reject</summary><p style={{ marginTop: 6 }}>Both are final, attributed to you, and notify the family and the student. Approved days count as excused in the register.</p></details>
            <details className="t-bsm ink2"><summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>Awaiting guardian</summary><p style={{ marginTop: 6 }}>Student-raised requests wait for a guardian's authorisation first. They reach your queue only once a guardian has signed.</p></details>
            <details className="t-bsm ink2"><summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>Clinic notes</summary><p style={{ marginTop: 6 }}>Medical leave beyond the school's document threshold needs a note attached before it can be submitted; shorter medical leave may arrive without one.</p></details>
          </div>
        </div>
      </div>
    </>
  );
}
