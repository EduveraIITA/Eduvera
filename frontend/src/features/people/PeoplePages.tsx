export function PeoplePages({ page, total, pageSize, onPage, label }: { page: number; total: number; pageSize: number; onPage: (page: number) => void; label: string }) {
  if (page === 1 && total <= pageSize) return null;
  return <nav className="participation-pagination" aria-label={label}><button type="button" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span><button type="button" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>Next</button></nav>;
}
