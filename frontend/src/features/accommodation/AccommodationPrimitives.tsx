import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import type { StaySummary } from "./accommodationApi";
import type { useAccommodationCommand } from "./useAccommodationCommand";

export function stayLabel(stay: StaySummary) {
  if (stay.state === "accepted") return stay.actual_move_out_at ? "To settle" : stay.actual_move_in_at ? "Staying" : stay.arrangement_basis === "coordinator_allocation" ? "Assigned · move-in not recorded" : "Accepted · move-in not recorded";
  return ({ offered: "Awaiting response", declined: "Declined", cancelled: "Withdrawn", closed: "Closed" } as Record<string, string>)[stay.state] ?? "Review current state";
}
export function accommodationDate(value: string | null | undefined, timezone: string, time = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", year: "numeric", ...(time ? { hour: "numeric", minute: "2-digit" } as const : {}) }).format(new Date(value));
}
export function AccommodationEmpty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="accommodation-empty" role="status"><ProductIcon name="accommodation" size={36} /><h2>{title}</h2>{children ? <p className="accommodation-caption">{children}</p> : null}{action}</section>;
}
export function AccommodationPages({ page, hasMore, onChange, disabled = false, label = "Accommodation pages" }: { page: number; hasMore: boolean; onChange: (value: number) => void; disabled?: boolean; label?: string }) {
  if (page === 1 && !hasMore) return null;
  return <nav className="accommodation-pages" aria-label={label}><button type="button" className="is-secondary" disabled={disabled || page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</button><span>Page {page}</span><button type="button" className="is-secondary" disabled={disabled || !hasMore} onClick={() => onChange(page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button></nav>;
}
export function AccommodationReadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <section className="accommodation-empty" role="alert"><h2>This view could not be loaded</h2><p>{error instanceof Error ? error.message : "Refresh to try again. No action has been recorded."}</p><button type="button" className="is-secondary" onClick={onRetry}>Try again</button></section>;
}
export function AccommodationWriteFeedback({ write, onReview }: { write: ReturnType<typeof useAccommodationCommand>; onReview?: () => void }) {
  return <>{write.error ? <p className="accommodation-error" role="alert">{write.error}</p> : null}{write.recovery ? <div className="accommodation-feedback"><p className="accommodation-caption">{write.recovery === "accepted" ? "Saved; only the updated view is waiting." : "Your unchanged action is kept until its result is known."}</p><button type="button" className="is-secondary" disabled={write.busy} onClick={() => void write.recover()}>{write.busy ? "Checking…" : write.recovery === "accepted" ? "Refresh saved record" : write.retrySafe ? "Retry same action" : "Check result"}</button></div> : null}{write.obsolete && onReview ? <button type="button" className="is-secondary" onClick={onReview}>Review current record</button> : null}</>;
}
