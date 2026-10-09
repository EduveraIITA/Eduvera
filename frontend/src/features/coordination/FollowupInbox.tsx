import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CheckCheck, ChevronDown, MessageSquare } from "lucide-react";
import { useOptionalAuth } from "../auth/AuthContext";
import { getFollowups, type FollowupContext } from "./api";
import { FollowupThread } from "./FollowupThread";
import "./followups.css";

export function FollowupInbox(props: { context: FollowupContext; studentId?: string; hideWithoutOpenFollowups?: boolean; showHeading?: boolean }) {
  const auth = useOptionalAuth();
  if (auth?.status !== "authenticated") return null;
  return <Inbox key={`${auth.user?.id}:${props.studentId ?? "all"}`} {...props} userId={auth.user!.id} />;
}

function Inbox({ context, studentId, userId, hideWithoutOpenFollowups = false, showHeading = true }: { context: FollowupContext; studentId?: string; userId: string; hideWithoutOpenFollowups?: boolean; showHeading?: boolean }) {
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const [selected, setSelected] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["school", "coordination", context, userId, studentId ?? "all", filter],
    queryFn: ({ pageParam }) => getFollowups(context, filter, studentId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const records = query.data?.pages.flatMap((page) => page.results) ?? [];
  if (hideWithoutOpenFollowups && filter === "open" && (query.isPending || query.isError || records.length === 0)) return null;
  return <section className="followup-panel" id="attendance-followups" aria-label="Attendance follow-ups">
    <header className="followup-panel__heading">{showHeading ? <div><span className="followup-eyebrow">School & home</span><h2><MessageSquare size={20} />Attendance follow-ups</h2></div> : null}
      <div className="followup-filters" aria-label="Follow-up status">
        {(["open", "resolved"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setSelected(null); }}>{value === "open" ? "Open" : "Resolved"}</button>)}
      </div>
    </header>
    {query.isPending ? <p role="status">Loading follow-ups…</p> : null}
    {query.isError ? <div className="followup-error" role="alert"><p>Follow-ups could not load.</p><button type="button" onClick={() => void query.refetch()}>Try again</button></div> : null}
    {!query.isPending && !query.isError && records.length === 0 ? <div className="followup-empty"><CheckCheck size={22} /><div><strong>{filter === "open" ? "No open attendance follow-ups" : "No resolved follow-ups yet"}</strong><p>{context === "guardian" ? "Questions from your child’s teacher will appear here." : "Raise a follow-up from a student’s recorded attendance when clarification is needed."}</p></div></div> : null}
    <div className="followup-list">{records.map((item) => <article key={item.id}>
      <button className="followup-row" type="button" aria-expanded={selected === item.id} aria-controls={`followup-${item.id}`} onClick={() => setSelected(selected === item.id ? null : item.id)}>
        <span><strong>{item.student_name}</strong><small>{new Date(`${item.attendance_date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {item.owner_name}</small><span>{item.question}</span></span>
        <span className="followup-row__state"><span className={`followup-chip is-${item.state}`}>{item.state === "awaiting_response" ? "Awaiting reply" : item.state === "in_review" ? "School review" : "Resolved"}</span>{item.overdue ? <small className="followup-overdue">Response overdue</small> : null}<ChevronDown size={18} /></span>
      </button>
      {selected === item.id ? <div id={`followup-${item.id}`}><FollowupThread id={item.id} context={context} /></div> : null}
    </article>)}</div>
    {query.hasNextPage ? <button className="followup-more" type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading…" : "Load more follow-ups"}</button> : null}
  </section>;
}
