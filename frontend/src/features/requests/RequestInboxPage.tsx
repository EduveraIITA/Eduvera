import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Award,
  BookOpenCheck,
  Bus,
  CalendarDays,
  CalendarX2,
  ClipboardCheck,
  MessageSquareText,
  ReceiptIndianRupee,
  RefreshCw,
  Scale,
  ShieldAlert,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { portalReturnState } from "../navigation/portalReturnState";
import {
  getRequestsInbox,
  type RequestCategory,
  type RequestInboxItem,
  type RequestInboxResponse,
  type RequestPortal,
  type RequestPriority,
} from "./api";
import "./request-inbox.css";

const categoryMeta: Record<RequestCategory, { label: string; icon: LucideIcon }> = {
  attendance: { label: "Attendance", icon: ClipboardCheck },
  academics: { label: "Academics", icon: Award },
  events: { label: "Events", icon: CalendarDays },
  leave: { label: "Leave", icon: CalendarX2 },
  staffing: { label: "Staffing", icon: UserRoundCheck },
  transport: { label: "Transport", icon: Bus },
  finance: { label: "Finance", icon: ReceiptIndianRupee },
  governance: { label: "Policies", icon: Scale },
  communication: { label: "Communication", icon: MessageSquareText },
  care: { label: "Student care", icon: ShieldAlert },
};

const stackMeta: Array<{ id: RequestPriority; title: string }> = [
  { id: "urgent", title: "Urgent" },
  { id: "high", title: "Next" },
  { id: "normal", title: "Later" },
];

function isRequestCategory(value: string | null): value is RequestCategory {
  return value !== null && Object.prototype.hasOwnProperty.call(categoryMeta, value);
}

function timeLabel(value: string | null, timezone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    ...(value.includes("T") && !value.includes("T12:00:00.000Z") ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function RequestRow({ item, timezone, returnTo }: { item: RequestInboxItem; timezone: string; returnTo: string }) {
  const meta = categoryMeta[item.category];
  const Icon = meta.icon;
  const due = timeLabel(item.due_at, timezone);
  return (
    <Link className={`request-row request-row--${item.priority}`} to={item.href} state={portalReturnState(returnTo, item.href)}>
      <span className="request-row__icon" aria-hidden="true"><Icon size={19} /></span>
      <span className="request-row__body">
        <span className="request-row__eyebrow">
          <b>{item.status_label}</b>
          {due ? <time dateTime={item.due_at ?? undefined}>Due {due}</time> : null}
        </span>
        <strong>{item.title}</strong>
        <small>{item.detail}</small>
        {item.subject_label ? <span className="request-row__subject">{item.subject_label}</span> : null}
      </span>
      <span className="request-row__action">{item.action_label}<ArrowRight size={15} aria-hidden="true" /></span>
    </Link>
  );
}

function LoadingState() {
  return <div className="request-loading" role="status" aria-label="Loading requests">
    <span /><span /><span />
  </div>;
}

export function RequestInboxView({ data }: { data: RequestInboxResponse }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requestedCategory = params.get("category");
  const category: RequestCategory | "all" = isRequestCategory(requestedCategory) ? requestedCategory : "all";
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const setCategory = (nextCategory: RequestCategory | "all") => {
    const next = new URLSearchParams(params);
    if (nextCategory === "all") next.delete("category");
    else next.set("category", nextCategory);
    setParams(next, { replace: true });
  };
  const categories = useMemo(() => Object.entries(data.summary.categories)
    .filter((entry): entry is [RequestCategory, number] => Boolean(entry[1]))
    .sort((left, right) => categoryMeta[left[0]].label.localeCompare(categoryMeta[right[0]].label)), [data.summary.categories]);
  const visible = category === "all" ? data.items : data.items.filter((item) => item.category === category);
  return <div className="requests-page">
    {categories.length > 1 ? <div className="request-filters" role="group" aria-label="Filter requests by category">
      <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>All <span>{data.summary.total}</span></button>
      {categories.map(([id, count]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>{categoryMeta[id].label} <span>{count}</span></button>)}
    </div> : null}

    {visible.length ? <div className="request-stacks">
      {stackMeta.map((stack) => {
        const items = visible.filter((item) => item.priority === stack.id);
        if (!items.length) return null;
        return <section className={`request-stack request-stack--${stack.id}`} key={stack.id} aria-labelledby={`request-stack-${stack.id}`}>
          <header><h2 id={`request-stack-${stack.id}`}>{stack.title}</h2><span aria-label={`${items.length} ${items.length === 1 ? "item" : "items"}`}>{items.length}</span></header>
          <div className="request-stack__list">{items.map((item) => <RequestRow key={item.id} item={item} timezone={data.scope.timezone} returnTo={returnTo} />)}</div>
        </section>;
      })}
    </div> : <section className="requests-empty" role="status"><BookOpenCheck size={28} aria-hidden="true" /><h2>Nothing needs your attention</h2><p>{category === "all" ? "New requests will appear here when you need to respond." : `There are no ${categoryMeta[category].label.toLowerCase()} requests right now.`}</p></section>}
  </div>;
}

function RequestInboxRoute({ portal }: { portal: RequestPortal }) {
  const [params] = useSearchParams();
  const studentId = portal === "parent" ? params.get("student_id") ?? undefined : undefined;
  const query = useQuery({
    queryKey: ["requests", portal, studentId ?? "default"],
    queryFn: () => getRequestsInbox(portal, studentId),
    staleTime: 15_000,
    refetchOnMount: "always",
  });
  const content = query.isPending ? <LoadingState /> : query.isError ? <section className="requests-error" role="alert"><AlertCircle size={24} /><h2>Requests are unavailable</h2><p>{query.error instanceof Error ? query.error.message : "Try again in a moment."}</p><button type="button" onClick={() => void query.refetch()}><RefreshCw size={16} />Try again</button></section> : query.data ? <RequestInboxView data={query.data} /> : null;
  if (portal === "parent") return <ParentShell active="more" pageLabel="Requests" backTo="/parent/more" selectedChildId={query.data?.scope.student_id ?? studentId}>{content}</ParentShell>;
  return <OperationsShell portal={portal} active="more" title="Requests" backTo={`/${portal}/more`}>{content}</OperationsShell>;
}

export function ParentRequestsRoute() { return <RequestInboxRoute portal="parent" />; }
export function TeacherRequestsRoute() { return <RequestInboxRoute portal="teacher" />; }
export function PrincipalRequestsRoute() { return <RequestInboxRoute portal="principal" />; }

export default RequestInboxRoute;
