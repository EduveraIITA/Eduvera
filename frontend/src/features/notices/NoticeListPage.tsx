import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronRight, FileText, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { currentStaffMembership, hasStaffPermission } from "../auth/staffAccess";
import { getNotices, type NoticePortal, type NoticeStatus, type NoticeSummary } from "./api";
import { NoticeShell } from "./NoticeShell";

const filters: Array<{ id: "all" | NoticeStatus; label: string }> = [
  { id: "all", label: "All" }, { id: "published", label: "Published" }, { id: "draft", label: "Drafts" }, { id: "cancelled", label: "Cancelled" },
];

function dateLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function responseLabel(notice: NoticeSummary) {
  if (notice.status === "draft") return "Draft";
  if (notice.status === "cancelled") return "Cancelled";
  if (notice.response_mode === "information") return "For information";
  if (notice.responded_at) return notice.response_mode === "choice" ? notice.response_value ?? "Responded" : "Acknowledged";
  return notice.response_mode === "choice" ? "Response needed" : "Acknowledgement needed";
}

function NoticeRow({ notice, portal, studentId }: { notice: NoticeSummary; portal: NoticePortal; studentId?: string }) {
  const suffix = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
  const progress = notice.recipient_count ? `${notice.response_count ?? 0} of ${notice.recipient_count} responded` : null;
  return <Link className="notice-row" to={`/${portal}/notices/${encodeURIComponent(notice.id)}${suffix}`}>
    <span className={`notice-row__mark notice-tone--${notice.priority}`} aria-hidden="true"><FileText size={18} /></span>
    <span className="notice-row__content">
      <span className="notice-row__meta"><b>{responseLabel(notice)}</b>{notice.due_at ? <time dateTime={notice.due_at}>Due {dateLabel(notice.due_at)}</time> : null}</span>
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
  const [filter, setFilter] = useState<"all" | NoticeStatus>("all");
  const query = useQuery({ queryKey: ["notices", portal, schoolId, studentId], queryFn: () => getNotices(portal, { schoolId, studentId }), staleTime: 15_000 });
  const visible = useMemo(() => (query.data?.results ?? []).filter((notice) => filter === "all" || notice.status === filter), [filter, query.data]);
  const resolvedStudentId = query.data?.student_id ?? studentId;
  const canCompose = portal === "principal" || (portal === "teacher" && hasStaffPermission(currentStaffMembership(auth.memberships), "messages.send"));
  const compose = canCompose ? <Link className="notice-header-action" to={`/${portal}/notices/new`} aria-label="Create notice"><Plus size={19} /><span>New</span></Link> : null;
  return <NoticeShell portal={portal} title="Notices" backTo={`/${portal}/more`} studentId={resolvedStudentId ?? undefined} trailing={compose}>
    <div className="notices-workspace">
      <div className="notice-filters" role="group" aria-label="Filter notices">
        {filters.filter((item) => portal !== "parent" || item.id === "all" || item.id === "published" || item.id === "cancelled").map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
      </div>
      {query.isPending ? <div className="notice-loading" role="status" aria-label="Loading notices"><span /><span /><span /></div>
        : query.isError ? <section className="notice-state notice-state--error" role="alert"><AlertCircle size={24} /><strong>Notices are unavailable</strong><p>{query.error instanceof Error ? query.error.message : "Try again in a moment."}</p><button type="button" onClick={() => void query.refetch()}><RefreshCw size={16} />Try again</button></section>
          : visible.length ? <section className="notice-list" aria-label="Notices">{visible.map((notice) => <NoticeRow key={notice.id} notice={notice} portal={portal} studentId={resolvedStudentId ?? undefined} />)}</section>
            : <section className="notice-state" role="status"><span className="notice-state__icon"><Check size={24} /></span><strong>{filter === "all" ? "No notices yet" : `No ${filter} notices`}</strong><p>{portal === "parent" ? "School notices will appear here." : "Create a notice when the school needs to inform people or collect a response."}</p></section>}
    </div>
  </NoticeShell>;
}
