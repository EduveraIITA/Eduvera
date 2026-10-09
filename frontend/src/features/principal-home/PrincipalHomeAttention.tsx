import { BookOpen, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, MessageSquareText, TrendingDown, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { PrincipalHomeResponse } from "../operations/api";
import type { usePrincipalHomeQueries } from "./usePrincipalHomeQueries";

interface AttentionItem { id: string; title: string; detail: string; count: number | string; href: string; icon: typeof BookOpen; urgent?: boolean }

export function PrincipalHomeAttention({ data, date, queries }: { data: PrincipalHomeResponse; date: string; queries: ReturnType<typeof usePrincipalHomeQueries> }) {
  const { allowed, review: query, analytics } = queries;
  const review = query.isError ? undefined : query.data;
  const items: AttentionItem[] = [];
  const followups = review ? review.followups.awaiting + review.followups.review : 0;
  if (followups) items.push({ id: "followups", title: "Attendance follow-ups", detail: review!.followups.overdue ? `${review!.followups.overdue} overdue · review the next step` : review!.followups.review ? `${review!.followups.review} ready for school review` : "Awaiting family replies", count: followups, href: `/principal/followups?date=${date}`, icon: MessageSquareText, urgent: Boolean(review!.followups.overdue) });
  const mismatches = data.classes.filter(item => item.submission_authorized === false || (item.can_mark === false && (item.marked_count > 0 || item.submission_status !== "not_started"))).length;
  if (mismatches) items.push({ id: "registers", title: "Check saved registers", detail: "Assignment or schedule has changed", count: mismatches, href: `/principal/attendance?date=${date}`, icon: ClipboardCheck, urgent: true });
  const pending = Math.max(0, data.summary.classes_total - data.summary.classes_submitted);
  if (pending && !mismatches) items.push({ id: "pending", title: "Registers to submit", detail: `${data.summary.classes_submitted} of ${data.summary.classes_total} submitted for this date`, count: pending, href: `/principal/attendance?date=${date}`, icon: ClipboardCheck });
  const gaps = review?.schedule.reduce((sum, day) => sum + day.unassigned, 0) ?? 0;
  if (gaps) items.push({ id: "coverage", title: "Arrange teacher coverage", detail: "Unassigned periods · next 7 days", count: gaps, href: `/principal/insights/operations?date=${date}`, icon: BookOpen, urgent: true });
  if (review?.engagement.total) items.push({ id: "declines", title: "Attendance has fallen", detail: `${review.engagement.without_followup} without a follow-up · 28-day comparison`, count: review.engagement.total, href: `/principal/insights/review?date=${date}`, icon: TrendingDown });
  if (data.exceptions.length) items.push({ id: "minimum", title: "Below attendance minimum", detail: "Recorded attendance this term", count: data.exceptions.length === 20 ? "20 shown" : data.exceptions.length, href: `/principal/attendance/thresholds?date=${date}`, icon: UsersRound });
  if (review?.deadlines.length) items.push({ id: "deadlines", title: "Overlapping deadlines", detail: "Class-days with 3+ deadlines · next 7 days", count: review.deadlines.length, href: `/principal/insights/operations?date=${date}#principal-deadlines`, icon: CalendarClock });
  const ready = analytics.isError ? 0 : analytics.data?.assessments?.pipeline.filter(item => item.status === "submitted" || item.status === "moderated").reduce((sum, item) => sum + item.count, 0) ?? 0;
  if (ready) items.push({ id: "results", title: "Assessment decisions", detail: "Awaiting review or publication · this term", count: ready, href: "/principal/insights/progress?period=term", icon: BookOpen });
  const rows = items.map(item => <li key={item.id}><Link to={item.href}>
    <item.icon className="principal-home__row-icon" size={20} aria-hidden="true" />
    <span className="principal-home__row-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
    <span className={`principal-home__count${item.urgent ? " is-urgent" : ""}`}>{item.count}</span><ChevronRight size={16} aria-hidden="true" />
  </Link></li>);
  return <section className="principal-home__section" aria-labelledby="principal-attention-title">
    <header><h2 id="principal-attention-title">Needs attention</h2><Link to={`/principal/insights?date=${date}`}>Insights<ChevronRight size={15} aria-hidden="true" /></Link></header>
    <div className="principal-home__group">
      {rows.length ? <ul className="principal-home__rows">{rows.slice(0, 4)}</ul> : null}
      {rows.length > 4 ? <details className="principal-home__more-checks"><summary>{rows.length - 4} more {rows.length === 5 ? "check" : "checks"}</summary><ul className="principal-home__rows">{rows.slice(4)}</ul></details> : null}
      {allowed && query.isPending ? <p className="principal-home__notice" role="status">Checking follow-ups and attendance…</p> : null}
      {allowed && query.isError ? <div className="principal-home__notice" role="alert"><span>Some checks couldn’t load.</span><button type="button" onClick={() => void query.refetch()}>Retry</button></div> : null}
      {!items.length && query.isSuccess && analytics.isSuccess ? <p className="principal-home__notice"><CheckCircle2 size={19} aria-hidden="true" />No additional checks flagged.</p> : null}
      {!pending && !mismatches ? <Link className="principal-home__footer-link" to={`/principal/attendance?date=${date}`}>View registers<ChevronRight size={16} aria-hidden="true" /></Link> : null}
      {!followups ? <Link className="principal-home__footer-link" to={`/principal/followups?date=${date}`}>All follow-up conversations<ChevronRight size={16} aria-hidden="true" /></Link> : null}
    </div>
    {review && date !== review.operational_date ? <p className="principal-home__scope">Follow-ups and teacher coverage reflect today.</p> : null}
  </section>;
}
