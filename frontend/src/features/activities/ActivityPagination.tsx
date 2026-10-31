import { ChevronLeft, ChevronRight } from "lucide-react";

export function ActivityPagination({ page, pages, total, onPage, label = "records", singularLabel }: { page: number; pages: number; total: number; onPage: (page: number) => void; label?: string; singularLabel?: string }) {
  const singular = singularLabel ?? ({ records: "record", plans: "plan", registers: "register", matches: "match", "people matches": "person match", "history entries": "history entry" } as Record<string, string>)[label];
  const countLabel = total === 1 && singular ? singular : label;
  if (pages <= 1) return <p className="activity-page-count">{total} {countLabel}</p>;
  return <nav className="activity-pagination" aria-label={`${label} pages`}><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={17} />Previous</button><span>Page {page} of {pages} · {total} {countLabel}</span><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<ChevronRight size={17} /></button></nav>;
}
