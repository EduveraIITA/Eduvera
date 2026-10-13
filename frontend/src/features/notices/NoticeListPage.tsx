import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronRight, FileText, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { currentStaffMembership, hasStaffPermission } from "../auth/staffAccess";
import { getNotices, type NoticePortal, type NoticeStatus, type NoticeSummary } from "./api";
import { NoticeShell } from "./NoticeShell";

type NoticeFilter = "all" | "attention" | NoticeStatus;
const filters: Array<{ id: NoticeFilter; label: string }> = [
  { id: "all", label: "All" }, { id: "attention", label: "Needs attention" }, { id: "published", label: "Published" }, { id: "draft", label: "Drafts" }, { id: "cancelled", label: "Cancelled" },
];

function dateLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function responseLabel(notice: NoticeSummary) {
  if (notice.status === "draft") return "Draft";
  if (notice.status === "cancelled") return "Cancelled";
  if (notice.can_manage) {
    if (notice.attention_reasons?.includes("delivery_failed")) return "Delivery issue";
    if (notice.attention_reasons?.includes("response_overdue")) return "Responses overdue";
    if ((notice.pending_response_count ?? 0) > 0) return "Awaiting responses";
    return notice.response_mode === "information" ? "Published" : "Responses complete";
  }
  if (notice.response_mode === "information") return "For information";
  if (notice.responded_at) return notice.response_mode === "choice" ? notice.response_value ?? "Responded" : "Acknowledged";
  if (notice.due_at && new Date(notice.due_at).getTime() < Date.now()) return "Response period ended";
  return notice.response_mode === "choice" ? "Response needed" : "Acknowledgement needed";
}

function NoticeRow({ notice, portal, studentId }: { notice: NoticeSummary; portal: NoticePortal; studentId?: string }) {
  const query = new URLSearchParams();
  if (studentId) query.set("student_id", studentId);
  if (notice.can_manage && notice.attention_reasons?.some((reason) => reason === "delivery_failed" || reason === "response_overdue")) query.set("focus", "attention");
  const suffix = query.size ? `?${query.toString()}` : "";
  const unread = notice.attention_reasons?.includes("unread") ?? false;
  const exceptions = (notice.delivery_exception_count ?? 0) + (notice.attention_reasons?.includes("response_overdue") ? (notice.pending_response_count ?? 0) : 0);
  const progress = notice.recipient_count
    ? exceptions > 0 ? `${exceptions} ${exceptions === 1 ? "person needs" : "people need"} follow-up` : `${notice.response_count ?? 0} of ${notice.recipient_count} responded`
    : null;
  const state = responseLabel(notice);
  return <Link className={`notice-row${unread ? " is-unread" : ""}`} to={`/${portal}/notices/${encodeURIComponent(notice.id)}${suffix}`}
    aria-label={`${notice.title}. ${unread ? "New. " : ""}${state}`}>
    <span className={`notice-row__mark notice-tone--${notice.priority}`} aria-hidden="true"><FileText size={18} /></span>
    <span className="notice-row__content">
      <span className="notice-row__meta">{unread ? <span className="notice-row__new"><i />New</span> : null}<b>{state}</b>{notice.due_at ? <time dateTime={notice.due_at}>Due {dateLabel(notice.due_at)}</time> : null}</span>
      <strong>{notice.title}</strong>
      <small>{progress ?? notice.body}</small>
    </span>
    <ChevronRight size={18} aria-hidden="true" />
  </Link>;
}

export function NoticeListPage({ portal }: { portal: NoticePortal }) {
  const auth = useAuth();
  const [params] = useSearchParams();
  const studentId = portal === "parent" ? params.get("student_id") ?? undefined : undefined;
  const role = portal === "principal" ? "admin" : portal === "teacher" ? "staff" : "guardian";
  const schoolId = auth.memberships.find((membership) => membership.role === role)?.school_id;
  const [filter, setFilter] = useState<NoticeFilter>("all");
  const query = useQuery({ queryKey: ["notices", portal, schoolId, studentId], queryFn: () => getNotices(portal, { schoolId, studentId }), staleTime: 15_000 });
  const visible = useMemo(() => (query.data?.results ?? [])
    .filter((notice) => filter === "all" ? true : filter === "attention" ? Boolean(notice.attention_reasons?.length) : notice.status === filter)
    .sort((left, right) => Number(Boolean(right.attention_reasons?.length)) - Number(Boolean(left.attention_reasons?.length))), [filter, query.data]);
  const resolvedStudentId = query.data?.student_id ?? studentId;
  const canCompose = portal === "principal" || (portal === "teacher" && hasStaffPermission(currentStaffMembership(auth.memberships), "messages.send"));
  const compose = canCompose ? <Link className="notice-header-action" to={`/${portal}/notices/new`} aria-label="Create notice"><Plus size={19} /><span>New</span></Link> : null;
  return <NoticeShell portal={portal} title="Notices" backTo={`/${portal}/more`} studentId={resolvedStudentId ?? undefined} trailing={compose}>
    <div className="notices-workspace">
      <div className="notice-filters" role="group" aria-label="Filter notices">
        {filters.filter((item) => portal !== "parent" || item.id === "all" || item.id === "attention" || item.id === "published" || item.id === "cancelled").map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}{item.id === "attention" && query.data?.attention.total ? ` ${query.data.attention.total}` : ""}</button>)}
      </div>
      {query.isPending ? <div className="notice-loading" role="status" aria-label="Loading notices"><span /><span /><span /></div>
        : query.isError ? <section className="notice-state notice-state--error" role="alert"><AlertCircle size={24} /><strong>Notices are unavailable</strong><p>{query.error instanceof Error ? query.error.message : "Try again in a moment."}</p><button type="button" onClick={() => void query.refetch()}><RefreshCw size={16} />Try again</button></section>
          : visible.length ? <section className="notice-list" aria-label="Notices">{visible.map((notice) => <NoticeRow key={notice.id} notice={notice} portal={portal} studentId={resolvedStudentId ?? undefined} />)}</section>
            : <section className="notice-state" role="status"><span className="notice-state__icon"><Check size={24} /></span><strong>{filter === "all" ? "No notices yet" : `No ${filter} notices`}</strong><p>{portal === "parent" ? "School notices will appear here." : "Create a notice when the school needs to inform people or collect a response."}</p></section>}
    </div>
  </NoticeShell>;
}
