import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApiError } from "../../lib/api";
import type { ArrangedVisit } from "./visitApi";

export const visitAccessLost = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
export function visitDate(value: string, timezone: string, date = true) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, ...(date ? { day: "numeric", month: "short", year: "numeric" } as const : {}), hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
export function visitWindow(visit: Pick<ArrangedVisit, "starts_at" | "ends_at">, timezone: string) {
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(visit.starts_at)) === new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(visit.ends_at));
  return `${visitDate(visit.starts_at, timezone)} – ${visitDate(visit.ends_at, timezone, !sameDay)}`;
}
export function VisitReadError({ error, onRetry }: { error: unknown; onRetry: () => unknown }) {
  return <div className="visits-feedback" role="alert"><p>{error instanceof Error ? error.message : "Visits are unavailable."}</p><button type="button" className="is-secondary" onClick={() => void onRetry()}>Try again</button></div>;
}
export function VisitPages({ page, hasNext, busy = false, onChange }: { page: number; hasNext: boolean; busy?: boolean; onChange: (page: number) => void }) {
  if (page === 1 && !hasNext) return null;
  return <nav className="visits-pages" aria-label="Visit pages"><button type="button" className="is-secondary" disabled={busy || page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={18} aria-hidden="true" />Previous</button><span>Page {page}</span><button type="button" className="is-secondary" disabled={busy || !hasNext} onClick={() => onChange(page + 1)}>Next<ChevronRight size={18} aria-hidden="true" /></button></nav>;
}
