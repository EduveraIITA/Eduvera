import { applicationNow } from "../simulation/applicationTime";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronRight, FileText, Plus, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ProductIcon } from "../../components/ProductIcon";
import { currentStaffMembership, hasStaffPermission } from "../auth/staffAccess";
import { getNotices, getWorkspaceNotices, type NoticePortal, type NoticeStatus, type NoticeSummary } from "./api";
import { NoticeShell } from "./NoticeShell";
import {
  canComposeNotice,
  noticeDetailPath,
  noticeListPath,
  type NoticeExperienceContext,
  type NoticeWorkspaceContext,
} from "./noticeWorkspaceContext";

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
  if (notice.due_at && new Date(notice.due_at).getTime() < applicationNow().getTime()) return "Response period ended";
  return notice.response_mode === "choice" ? "Response needed" : "Acknowledgement needed";
}

function NoticeRow({ notice, context, filter, page }: { notice: NoticeSummary; context: NoticeExperienceContext; filter: NoticeFilter; page: number }) {
  const destination = new URL(noticeDetailPath(context, notice.id), "https://thatcampus.invalid");
  const query = destination.searchParams;
  if (filter !== "all") query.set("view", filter);
  if (page > 1) query.set("updates_page", String(page));
  if (notice.can_manage && notice.attention_reasons?.some((reason) => reason === "delivery_failed" || reason === "response_overdue")) query.set("focus", "attention");
  const suffix = query.size ? `?${query.toString()}` : "";
  const unread = notice.attention_reasons?.includes("unread") ?? false;
  const exceptions = (notice.delivery_exception_count ?? 0) + (notice.attention_reasons?.includes("response_overdue") ? (notice.pending_response_count ?? 0) : 0);
  const progress = notice.recipient_count
    ? exceptions > 0 ? `${exceptions} ${exceptions === 1 ? "person needs" : "people need"} follow-up` : `${notice.response_count ?? 0} of ${notice.recipient_count} responded`
    : null;
  const state = responseLabel(notice);
  return <Link className={`notice-row${unread ? " is-unread" : ""}`} to={`${destination.pathname}${suffix}`}
    aria-label={`${notice.title}. ${unread ? "New. " : ""}${state}`}>
    <span className={`notice-row__mark notice-tone--${notice.priority}`} aria-hidden="true">{notice.priority === "normal" ? <ProductIcon name="updates" size={28} /> : <FileText size={22} />}</span>
    <span className="notice-row__content">
      <span className="notice-row__meta">{unread ? <span className="notice-row__new"><i />New</span> : null}<b>{state}</b>{notice.due_at ? <time dateTime={notice.due_at}>Due {dateLabel(notice.due_at)}</time> : null}</span>
      <strong>{notice.title}</strong>
      <small>{progress ?? notice.body}</small>
    </span>
    <ChevronRight size={18} aria-hidden="true" />
  </Link>;
}

type NoticeListPageProps =
  | { readonly portal: NoticePortal; readonly workspace?: never }
  | {
      readonly portal?: never;
      readonly workspace: NoticeWorkspaceContext;
      readonly workspaceOptions?: readonly (NoticeWorkspaceContext & { readonly key: string })[];
      readonly onWorkspaceChange?: (key: string) => void;
    };

function newNoticePath(context: NoticeExperienceContext, filter: NoticeFilter, page: number) {
  const destination = new URL(noticeListPath(context), "https://thatcampus.invalid");
  destination.pathname += "/new";
  if (filter !== "all") destination.searchParams.set("view", filter);
  if (page > 1) destination.searchParams.set("updates_page", String(page));
  return `${destination.pathname}${destination.search}`;
}

export function NoticeListPage(props: NoticeListPageProps) {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const workspaceOptions = props.workspace ? props.workspaceOptions : undefined;
  const onWorkspaceChange = props.workspace ? props.onWorkspaceChange : undefined;
  const context: NoticeExperienceContext = props.workspace
    ? { kind: "workspace", workspace: props.workspace }
    : {
        kind: "legacy",
        portal: props.portal,
        ...(props.portal === "parent" && params.get("student_id") ? { studentId: params.get("student_id")! } : {}),
      };
  const portal = context.kind === "legacy" ? context.portal : null;
  const studentId = context.kind === "workspace"
    ? context.workspace.studentId
    : portal === "parent" ? params.get("student_id") ?? undefined : undefined;
  const role = portal === "principal" ? "admin" : portal === "teacher" ? "staff" : "guardian";
  const schoolId = context.kind === "workspace"
    ? context.workspace.schoolId
    : auth.memberships.find((membership) => membership.role === role)?.school_id;
  const requestedFilter = params.get("view");
  const filter: NoticeFilter = filters.some((item) => item.id === requestedFilter) ? requestedFilter as NoticeFilter : "all";
  const contextKey = context.kind === "workspace" ? context.workspace.scope : context.portal;
  const query = useQuery<Awaited<ReturnType<typeof getNotices>> | Awaited<ReturnType<typeof getWorkspaceNotices>>>({
    queryKey: ["notices", contextKey, schoolId, studentId],
    queryFn: () => context.kind === "workspace"
      ? getWorkspaceNotices(context.workspace.scope, { schoolId, studentId })
      : getNotices(context.portal, { schoolId, studentId }),
    staleTime: 15_000,
  });
  const visible = useMemo(() => (query.data?.results ?? [])
    .filter((notice) => filter === "all" ? true : filter === "attention" ? Boolean(notice.attention_reasons?.length) : notice.status === filter)
    .sort((left, right) => Number(Boolean(right.attention_reasons?.length)) - Number(Boolean(left.attention_reasons?.length))), [filter, query.data]);
  const resolvedStudentId = query.data?.student_id ?? studentId;
  const pageCount = Math.max(1, Math.ceil(visible.length / 20));
  const requestedPage = Number(params.get("updates_page") ?? 1);
  const page = Number.isFinite(requestedPage) ? Math.min(pageCount, Math.max(1, Math.floor(requestedPage))) : 1;
  const setPage = (nextPage: number) => { const next = new URLSearchParams(params); if (nextPage === 1) next.delete("updates_page"); else next.set("updates_page", String(nextPage)); setParams(next); };
  const canCompose = context.kind === "workspace"
    ? canComposeNotice(context)
    : portal === "principal" || (portal === "teacher" && hasStaffPermission(currentStaffMembership(auth.memberships), "messages.send"));
  const compose = canCompose ? <Link className="notice-header-action" to={newNoticePath(context, filter, page)} aria-label="Create update"><Plus size={19} /><span>New</span></Link> : null;
  const recipientView = context.kind === "workspace" ? context.workspace.scope === "dependent" : portal === "parent";
  const backTo = context.kind === "workspace" ? "/areas/messages" : `/${portal}/more`;
  return <NoticeShell context={context} title={context.kind === "workspace" ? "Updates" : "Notices"} backTo={backTo} studentId={resolvedStudentId ?? undefined} trailing={compose}>
    <div className="notices-workspace">
      {context.kind === "workspace" ? <section className="notice-workspace-context" aria-label="Update scope">
        <span><small>Update scope</small><strong>{context.workspace.label}</strong>{context.workspace.description ? <span>{context.workspace.description}</span> : null}</span>
        {workspaceOptions && workspaceOptions.length > 1 ? <label><span className="sr-only">Choose update scope</span><select value={workspaceOptions.find((option) => option.scope === context.workspace.scope && option.studentId === context.workspace.studentId)?.key} onChange={(event) => onWorkspaceChange?.(event.target.value)}>{workspaceOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label> : null}
      </section> : null}
      <div className="notice-filters" role="group" aria-label="Filter notices">
        {filters.filter((item) => !recipientView || item.id === "all" || item.id === "attention" || item.id === "published" || item.id === "cancelled").map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => { const next = new URLSearchParams(params); next.delete("updates_page"); if (item.id === "all") next.delete("view"); else next.set("view", item.id); setParams(next, { replace: true }); }}>{item.label}{item.id === "attention" && query.data?.attention.total ? ` ${query.data.attention.total}` : ""}</button>)}
      </div>
      {query.isPending ? <div className="notice-loading" role="status" aria-label="Loading notices"><span /><span /><span /></div>
        : query.isError ? <section className="notice-state notice-state--error" role="alert"><AlertCircle size={24} /><strong>Notices are unavailable</strong><p>{query.error instanceof Error ? query.error.message : "Try again in a moment."}</p><button type="button" onClick={() => void query.refetch()}><RefreshCw size={16} />Try again</button></section>
          : visible.length ? <section className="notice-list" aria-label="Updates">{visible.slice((page - 1) * 20, page * 20).map((notice) => <NoticeRow key={notice.id} notice={notice} context={context} filter={filter} page={page} />)}</section>
            : <section className="notice-state" role="status"><span className="notice-state__icon"><Check size={24} /></span><strong>{filter === "all" ? `No ${context.kind === "workspace" ? "updates" : "notices"} yet` : `No ${filter} ${context.kind === "workspace" ? "updates" : "notices"}`}</strong><p>{recipientView ? "School updates will appear here." : "Create an update when the campus needs to inform people or collect a response."}</p></section>}
      {pageCount > 1 && query.isSuccess ? <nav className="notice-pagination" aria-label="Update pages"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pageCount} · {visible.length} updates</span><button type="button" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Next</button></nav> : null}
    </div>
  </NoticeShell>;
}
