import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";

export function ResourceEmpty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="resource-empty" role="status">
    <ProductIcon name="resources" size={36} />
    <h2>{title}</h2>{children ? <p className="resource-caption">{children}</p> : null}{action}
  </section>;
}

export function ResourcePages({ page, hasMore, onChange, disabled = false, label = "Resource pages" }: {
  page: number; hasMore: boolean; onChange: (page: number) => void; disabled?: boolean; label?: string;
}) {
  if (page === 1 && !hasMore) return null;
  return <nav className="resource-pages" aria-label={label}>
    <button type="button" className="is-secondary" disabled={disabled || page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</button>
    <span>Page {page}</span>
    <button type="button" className="is-secondary" disabled={disabled || !hasMore} onClick={() => onChange(page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button>
  </nav>;
}

export function ResourceReadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <section className="resource-read-error" role="alert"><h2>This record could not be loaded</h2>
    <p>{error instanceof Error ? error.message : "Refresh to try again. No action has been recorded."}</p>
    <button type="button" className="is-secondary" onClick={onRetry}>Try again</button>
  </section>;
}

export const resourceDate = (value: string | null | undefined, timezone: string, withTime = false) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } as const : {}) }).format(new Date(value));
};
