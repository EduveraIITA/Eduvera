import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CheckCheck, ChevronDown, Clock3, MessageCircleMore, MessageSquare } from "lucide-react";
import { useOptionalAuth } from "../auth/AuthContext";
import { getFollowup, getFollowups, type FollowupContext } from "./api";
import { FollowupThread } from "./FollowupThread";
import "./followups.css";

const followupStateLabel = {
  awaiting_response: "Awaiting reply",
  in_review: "School review",
  resolved: "Resolved",
} as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function attendanceDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function FollowupInbox(props: { context: FollowupContext; studentId?: string; hideWithoutOpenFollowups?: boolean; showHeading?: boolean; initialFollowupId?: string }) {
  const auth = useOptionalAuth();
  if (auth?.status !== "authenticated") return null;
  return <Inbox key={`${auth.user?.id}:${props.studentId ?? "all"}:${props.initialFollowupId ?? "none"}`} {...props} userId={auth.user!.id} />;
}

function Inbox({ context, studentId, userId, hideWithoutOpenFollowups = false, showHeading = true, initialFollowupId }: { context: FollowupContext; studentId?: string; userId: string; hideWithoutOpenFollowups?: boolean; showHeading?: boolean; initialFollowupId?: string }) {
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const [selected, setSelected] = useState<string | null>(initialFollowupId ?? null);
  const query = useInfiniteQuery({
    queryKey: ["school", "coordination", context, userId, studentId ?? "all", filter],
    queryFn: ({ pageParam }) => getFollowups(context, filter, studentId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const selectedQuery = useQuery({
    queryKey: ["school", "coordination", "detail", context, initialFollowupId],
    queryFn: () => getFollowup(initialFollowupId!, context),
    enabled: Boolean(initialFollowupId),
  });
  const records = useMemo(() => {
    const pageRecords = query.data?.pages.flatMap((page) => page.results) ?? [];
    if (!selectedQuery.data || pageRecords.some((item) => item.id === selectedQuery.data.id)) return pageRecords;
    return [selectedQuery.data, ...pageRecords];
  }, [query.data, selectedQuery.data]);
  const exactTargetVisible = Boolean(initialFollowupId && records.some((item) => item.id === initialFollowupId));
  const exactTargetLoading = Boolean(initialFollowupId && selectedQuery.isPending && !exactTargetVisible);
  const exactTargetError = Boolean(initialFollowupId && selectedQuery.isError && !exactTargetVisible);
  useEffect(() => {
    if (!initialFollowupId || !records.some((item) => item.id === initialFollowupId)) return;
    const target = document.getElementById(`attention-followup-${initialFollowupId}`);
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    target?.querySelector<HTMLButtonElement>(".followup-row")?.focus({ preventScroll: true });
  }, [initialFollowupId, records]);
  if (!initialFollowupId && hideWithoutOpenFollowups && filter === "open" && (query.isPending || query.isError || records.length === 0)) return null;
  return <section className={`followup-panel${showHeading ? "" : " followup-panel--standalone"}`} id="attendance-followups" aria-label="Attendance follow-ups">
    <header className="followup-panel__heading">{showHeading ? <div><span className="followup-eyebrow">School & home</span><h2><MessageSquare size={20} />Attendance follow-ups</h2></div> : null}
      <div className="followup-filters" role="group" aria-label="Follow-up status">
        {(["open", "resolved"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setSelected(null); }}>{value === "open" ? "Open" : "Resolved"}</button>)}
      </div>
    </header>
    {exactTargetLoading || query.isPending ? <div className="followup-loading" role="status" aria-label={exactTargetLoading ? "Opening the selected follow-up" : "Loading follow-ups"}><i /><i /><i /></div> : null}
    {exactTargetError ? <div className="followup-error followup-error--target" role="alert"><strong>This follow-up could not be opened.</strong><p>It may no longer be available to you, or the connection may have been interrupted.</p><button type="button" onClick={() => void selectedQuery.refetch()}>Try again</button></div>
      : query.isError ? <div className="followup-error" role="alert"><p>Follow-ups could not load.</p><button type="button" onClick={() => void query.refetch()}>Try again</button></div> : null}
    {!exactTargetLoading && !exactTargetError && !query.isPending && !query.isError && records.length === 0 ? <div className="followup-empty"><CheckCheck size={22} /><div><strong>{filter === "open" ? "No open attendance follow-ups" : "No resolved follow-ups yet"}</strong><p>{context === "guardian" ? "Questions from your child’s teacher will appear here." : "Raise a follow-up from a student’s recorded attendance when clarification is needed."}</p></div></div> : null}
    <div className="followup-list">{records.map((item) => {
      const open = selected === item.id;
      const StateIcon = item.state === "resolved" ? CheckCheck : item.state === "in_review" ? MessageCircleMore : Clock3;
      return <article id={`attention-followup-${item.id}`} className={`${initialFollowupId === item.id ? "is-attention-target " : ""}${open ? "is-open" : ""}`.trim()} key={item.id}>
      <button className="followup-row" type="button" aria-expanded={selected === item.id} aria-controls={`followup-${item.id}`} onClick={() => setSelected(selected === item.id ? null : item.id)}>
        <span className="followup-row__avatar" aria-hidden="true">{initials(item.student_name)}</span>
        <span className="followup-row__copy"><strong>{item.student_name}</strong><small>{attendanceDate(item.attendance_date)} · {item.owner_name}</small><span className="followup-row__status"><span className={`followup-state is-${item.state}`}><StateIcon size={14} aria-hidden="true" />{followupStateLabel[item.state]}</span>{item.overdue ? <small className="followup-overdue"><Clock3 size={13} aria-hidden="true" />Overdue</small> : null}</span></span>
        <ChevronDown className="followup-row__chevron" size={19} aria-hidden="true" />
      </button>
      {open ? <div className="followup-disclosure" id={`followup-${item.id}`}><FollowupThread id={item.id} context={context} /></div> : null}
    </article>})}</div>
    {query.hasNextPage ? <button className="followup-more" type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading…" : "Load more follow-ups"}</button> : null}
  </section>;
}
