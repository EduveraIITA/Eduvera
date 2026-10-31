import type { Visitor, VisitorCounts, VisitorFilter, VisitorPagination } from "./api";

const filters: readonly VisitorFilter[] = ["all", "active", "pending", "approved", "inside", "closed"];

export function visitorFilterFromUrl(value: string | null): VisitorFilter {
  return filters.includes(value as VisitorFilter) ? value as VisitorFilter : "all";
}

export function visitorPageFromUrl(value: string | null) {
  const page = value && /^\d+$/.test(value) ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function visitorMatchesFilter(visitor: Visitor, filter: VisitorFilter) {
  return filter === "all" || (filter === "active" && ["pending", "approved", "inside"].includes(visitor.state))
    || (filter === "closed" && ["out", "denied", "expired"].includes(visitor.state)) || visitor.state === filter;
}

export function countVisibleVisitors(visitors: Visitor[]): VisitorCounts {
  return Object.fromEntries(filters.map((filter) => [filter, visitors.filter((visitor) => visitorMatchesFilter(visitor, filter)).length])) as VisitorCounts;
}

export function GateVisitorFilters({ filter, counts, hindi, busy, onChange }: {
  filter: VisitorFilter; counts: VisitorCounts; hindi: boolean; busy: boolean; onChange: (filter: VisitorFilter) => void;
}) {
  const labels = hindi
    ? { all: "सभी", active: "सक्रिय", pending: "अनुमति का इंतज़ार", approved: "स्वीकृत", inside: "अंदर", closed: "पूर्ण" }
    : { all: "All", active: "Active visits", pending: "Awaiting approval", approved: "Approved", inside: "Inside", closed: "Closed" };
  return <label className="gate-visitor-filter">
    <span>{hindi ? "आगंतुक फ़िल्टर" : "Filter visitors"}</span>
    <select value={filter} disabled={busy} onChange={(event) => onChange(event.target.value as VisitorFilter)}>
      {filters.map((key) => <option value={key} key={key}>{labels[key]} · {counts[key]}</option>)}
    </select>
  </label>;
}

export function GateVisitorPagination({ pagination, hindi, busy, onChange }: {
  pagination?: VisitorPagination; hindi: boolean; busy: boolean; onChange: (page: number) => void;
}) {
  if (!pagination || !pagination.total) return null;
  return <nav className="gate-visitor-pagination" aria-label={hindi ? "आगंतुक पृष्ठ" : "Visitor pages"}>
    <button type="button" disabled={busy || !pagination.has_previous} onClick={() => onChange(pagination.page - 1)}>{hindi ? "पिछला" : "Previous"}</button>
    <p role="status" aria-live="polite">{hindi
      ? `पृष्ठ ${pagination.page} / ${pagination.total_pages} · ${pagination.total} आगंतुक`
      : `Page ${pagination.page} of ${pagination.total_pages} · ${pagination.total} ${pagination.total === 1 ? "visitor" : "visitors"}`}</p>
    <button type="button" disabled={busy || !pagination.has_next} onClick={() => onChange(pagination.page + 1)}>{hindi ? "अगला" : "Next"}</button>
  </nav>;
}
