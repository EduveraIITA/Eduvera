import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import type { RepairState, RepairWait } from "./facilitiesApi";
import type { useFacilitiesCommand } from "./useFacilitiesCommand";

export const repairStateLabels: Record<RepairState, string> = {
  reported: "Awaiting acceptance", accepted: "Accepted", in_progress: "In progress", waiting: "Waiting",
  awaiting_verification: "Ready to check", closed: "Closed",
};
export const repairWaitLabels: Record<RepairWait, string> = {
  parts: "Parts", contractor: "Contractor", approval: "Approval", access: "Access", other: "Other",
};
export function repairDate(value: string | null | undefined, timezone: string, time = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not set";
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", year: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit" } as const : {}) }).format(new Date(value));
}
export function FacilitiesEmpty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="facilities-empty" role="status"><ProductIcon name="facilities" size={36} /><h2>{title}</h2>
    {children ? <p className="facilities-caption">{children}</p> : null}{action}</section>;
}
export function FacilitiesPages({ page, hasMore, onChange, disabled = false, label = "Repair pages" }: {
  page: number; hasMore: boolean; onChange: (page: number) => void; disabled?: boolean; label?: string;
}) {
  if (page === 1 && !hasMore) return null;
  return <nav className="facilities-pages" aria-label={label}><button type="button" className="is-secondary" disabled={disabled || page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</button>
    <span>Page {page}</span><button type="button" className="is-secondary" disabled={disabled || !hasMore} onClick={() => onChange(page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button></nav>;
}
export function FacilitiesReadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <section className="facilities-read-error" role="alert"><h2>This repair could not be loaded</h2><p>{error instanceof Error ? error.message : "Refresh to try again. No action has been recorded."}</p><button type="button" className="is-secondary" onClick={onRetry}>Try again</button></section>;
}
export function FacilitiesWriteFeedback({ write, onReview }: { write: ReturnType<typeof useFacilitiesCommand>; onReview?: () => void }) {
  return <>{write.error ? <p className="facilities-error" role="alert">{write.error}</p> : null}
    {write.recovery ? <div className="facilities-feedback"><p className="facilities-caption">{write.recovery === "accepted" ? "Saved; only the updated view is waiting." : "Your unchanged action is kept until its result is known."}</p>
      <button type="button" className="is-secondary" disabled={write.busy} onClick={() => void write.recover()}>{write.busy ? "Checking…" : write.recovery === "accepted" ? "Refresh saved record" : write.retrySafe ? "Retry same action" : "Check result"}</button></div> : null}
    {write.obsolete && onReview ? <button type="button" className="is-secondary" disabled={write.busy} onClick={onReview}>Review current record</button> : null}
  </>;
}
